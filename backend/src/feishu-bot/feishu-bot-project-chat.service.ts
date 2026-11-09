import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron } from '@nestjs/schedule';
import { In, IsNull, Repository } from 'typeorm';
import { Subscription } from 'rxjs';
import { User } from '../auth/user.entity';
import { TaskStatus } from '../common/enums';
import { splitMemberNames } from '../common/names';
import { SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID } from '../tasks/system-task-templates';
import { TaskRealtimeService } from '../tasks/task-realtime.service';
import { Task } from '../tasks/task.entity';
import { Worker } from '../workers/worker.entity';
import { Project } from '../projects/project.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotIdentityService } from './feishu-bot-identity.service';
import { markdownCard } from './feishu-bot-message.service';
import { FeishuBotProjectChat } from './feishu-bot-project-chat.entity';

/** 根任务终态后保留沟通群的时间 */
const DISSOLVE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

/** 建群失败重试上限（每分钟一轮） */
const CREATE_MAX_ATTEMPTS = 30;

/** 单次对账补建群的候选任务数上限 */
const CANDIDATE_LIMIT = 100;

/** 飞书建群单次最多邀请的用户数 */
const MAX_CHAT_MEMBERS = 50;

/** 群名总长度上限 */
const CHAT_NAME_LIMIT = 80;

/** 项目相关方角色；顺序同时决定建群卡片中的展示顺序 */
export const PROJECT_CHAT_ROLE_KEYS = [
  'frontend',
  'backend',
  'qa',
  'product',
  'client',
] as const;

/** 项目沟通群名称：保留固定前后缀，仅截断项目名 */
export function projectChatName(projectName: string): string {
  const prefix = 'LitaWork-需求-';
  const suffix = ' 沟通群';
  const name = projectName.trim() || '未命名项目';
  const available = Math.max(
    1,
    CHAT_NAME_LIMIT - prefix.length - suffix.length,
  );
  return `${prefix}${name.slice(0, available)}${suffix}`;
}

/** 项目人员中的相关方姓名（多人字段拆分、去重、保持角色顺序） */
export function projectStakeholderNames(
  resources: Project['resources'],
): string[] {
  const names: string[] = [];
  if (!resources) return names;
  for (const key of PROJECT_CHAT_ROLE_KEYS) {
    for (const name of splitMemberNames(resources[key])) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

interface ResolvedMembers {
  users: User[];
  openIds: string[];
  missingNames: string[];
}

/**
 * 项目交付沟通群：项目详情创建交付任务后建立飞书群。
 * - 拉入前端、后端、测试、产品等项目相关方；无法识别的成员跳过；
 * - 官方机器人建群并作为群主，绑定了飞书应用的执行机器人尽力拉入；
 * - 根任务和直接子任务状态变化实时推送，定时对账补偿漏发；
 * - 根任务完成/失败/取消/拒绝后保留 7 天，由定时任务自动解散。
 */
@Injectable()
export class FeishuBotProjectChatService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(FeishuBotProjectChatService.name);
  private readonly locks = new Map<string, Promise<void>>();
  private readonly pendingTaskIds = new Set<number>();
  private subscription: Subscription | null = null;
  private drainPromise: Promise<void> | null = null;
  private reconciling = false;

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly client: FeishuBotClientService,
    private readonly identities: FeishuBotIdentityService,
    private readonly realtime: TaskRealtimeService,
    @InjectRepository(FeishuBotProjectChat)
    private readonly chats: Repository<FeishuBotProjectChat>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  onModuleInit(): void {
    this.subscription = this.realtime.events$.subscribe((event) => {
      if (event.type !== 'upsert') return;
      this.enqueueTask(event.taskId);
    });
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.subscription = null;
  }

  /**
   * 点击「安排项目机器人」后的入口：幂等创建绑定并立即尝试建群。
   * 建群失败不回滚任务，保留绑定供定时对账重试。
   */
  async ensureForProjectTask(projectId: number, taskId: number): Promise<void> {
    const [project, task, official] = await Promise.all([
      this.projects.findOne({ where: { id: projectId } }),
      this.tasks.findOne({ where: { id: taskId } }),
      this.configs.loadEnabledOfficial(),
    ]);
    if (!project || !task || !official) return;
    if (
      task.parentId !== null ||
      task.templateId !== SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID
    ) {
      return;
    }

    let row = await this.chats.findOne({ where: { taskId } });
    if (!row) {
      await this.chats
        .createQueryBuilder()
        .insert()
        .into(FeishuBotProjectChat)
        .values({
          projectId,
          taskId,
          officialConfigId: official.id,
          state: 'creating',
          name: projectChatName(project.name),
          projectName: project.name,
          memberUserIds: [],
          memberNames: [],
          botIds: [],
          lastStatuses: {},
          finishedAt: null,
          finishedNotified: false,
          destroyAfter: null,
          attempts: 0,
          lastError: null,
        })
        .orIgnore()
        .execute();
      row = await this.chats.findOne({ where: { taskId } });
    }
    if (!row || row.state === 'destroyed' || row.chatId) return;
    if (row.attempts >= CREATE_MAX_ATTEMPTS) return;

    await this.withLock(`chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.chatId || fresh.state === 'destroyed') return;
      const secrets = this.configs.secretsOf(official);
      await this.createGroupChat(fresh, official, secrets, project, task);
    });
  }

  /** 每分钟对账：补建群 / 状态补偿 / 终态计时 / 到期解散 */
  @Cron('15 * * * * *')
  async reconcile(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      await this.reconcileOnce();
    } catch (error) {
      this.logger.warn(`项目沟通群对账失败: ${(error as Error).message}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async reconcileOnce(): Promise<void> {
    const official = await this.configs.loadEnabledOfficial();
    const rows = await this.chats.find();
    const rootIds = rows.map((row) => row.taskId);
    const [roots, projects, children] = await Promise.all([
      rootIds.length
        ? this.tasks.find({ where: { id: In(rootIds) } })
        : Promise.resolve([] as Task[]),
      rows.length
        ? this.projects.find({
            where: { id: In(rows.map((row) => row.projectId)) },
          })
        : Promise.resolve([] as Project[]),
      rootIds.length
        ? this.tasks.find({ where: { parentId: In(rootIds) } })
        : Promise.resolve([] as Task[]),
    ]);
    const rootMap = new Map(roots.map((task) => [task.id, task]));
    const projectMap = new Map(
      projects.map((project) => [project.id, project]),
    );
    const childrenMap = new Map<number, Task[]>();
    for (const child of children) {
      if (child.parentId === null) continue;
      const list = childrenMap.get(child.parentId) ?? [];
      list.push(child);
      childrenMap.set(child.parentId, list);
    }

    for (const row of rows) {
      if (row.state === 'destroyed') continue;
      const root = rootMap.get(row.taskId);
      const project = projectMap.get(row.projectId);
      if (!root || !project) {
        await this.destroyMissingGroup(row);
        continue;
      }
      if (!official || official.id !== row.officialConfigId) continue;
      const secrets = this.configs.secretsOf(official);

      await this.withLock(`chat:${row.id}`, async () => {
        const fresh = await this.chats.findOne({ where: { id: row.id } });
        if (!fresh || fresh.state === 'destroyed') return;
        if (
          (!fresh.chatId ||
            fresh.state === 'creating' ||
            fresh.state === 'error') &&
          fresh.attempts < CREATE_MAX_ATTEMPTS
        ) {
          await this.createGroupChat(fresh, official, secrets, project, root);
          return;
        }
        if (fresh.state !== 'active' || !fresh.chatId) return;

        await this.markRootFinished(fresh, root);
        await this.syncAgentBot(fresh, root, official, secrets);
        await this.notifyTaskStatus(fresh, root, root, secrets);
        for (const child of childrenMap.get(root.id) ?? []) {
          await this.notifyTaskStatus(fresh, child, root, secrets);
        }
        if (fresh.destroyAfter && fresh.destroyAfter.getTime() <= Date.now()) {
          await this.dissolve(fresh, secrets);
        }
      });
    }

    if (!official) return;
    const bound = new Set(rows.map((row) => row.taskId));
    const candidates = await this.tasks.find({
      where: {
        templateId: SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
        parentId: IsNull(),
        status: In([TaskStatus.WAITING, TaskStatus.RUNNING]),
      },
      order: { id: 'DESC' },
      take: CANDIDATE_LIMIT,
    });
    for (const task of candidates) {
      if (bound.has(task.id) || !task.projectId) continue;
      await this.ensureForProjectTask(task.projectId, task.id);
    }
  }

  /** 建群：相关方 + 可用执行机器人；机器人拉入失败时降级为仅拉用户 */
  private async createGroupChat(
    row: FeishuBotProjectChat,
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    project: Project,
    root: Task,
  ): Promise<void> {
    const members = await this.resolveMembers(official, project);
    const botIds = await this.resolveBotIds(root, official);
    try {
      let chatId: string;
      let addedBotIds = botIds;
      try {
        chatId = await this.client.createChat(
          official.id,
          secrets,
          row.name,
          `项目需求沟通群（项目 #${project.id}，任务 ${root.code}）`,
          members.openIds,
          { botIds, idempotencyKey: `project-chat-${row.id}` },
        );
      } catch (error) {
        if (botIds.length === 0) throw error;
        this.logger.warn(
          `项目沟通群拉入机器人失败，降级为仅拉用户（${root.code}）: ${(error as Error).message}`,
        );
        addedBotIds = [];
        chatId = await this.client.createChat(
          official.id,
          secrets,
          row.name,
          `项目需求沟通群（项目 #${project.id}，任务 ${root.code}）`,
          members.openIds,
          { idempotencyKey: `project-chat-${row.id}` },
        );
      }
      const lastStatuses = { ...row.lastStatuses };
      await this.chats.update(row.id, {
        chatId,
        state: 'active',
        officialConfigId: official.id,
        memberUserIds: members.users.map((user) => user.id),
        memberNames: members.users.map((user) => user.name),
        botIds: addedBotIds,
        lastStatuses,
        lastError: null,
      });
      Object.assign(row, {
        chatId,
        state: 'active',
        officialConfigId: official.id,
        memberUserIds: members.users.map((user) => user.id),
        memberNames: members.users.map((user) => user.name),
        botIds: addedBotIds,
        lastStatuses,
      });
      try {
        await this.client.sendCard(
          official.id,
          secrets,
          'chat_id',
          chatId,
          markdownCard(
            [
              '**[项目沟通群已创建]**',
              '',
              `- **项目**：${project.name}`,
              `- **交付任务**：${root.code} ${root.title}`,
              `- **任务状态**：${taskStatusText(root)}`,
              `- **项目成员**：${
                row.memberNames.length ? row.memberNames.join('、') : '暂无'
              }`,
              ...(members.missingNames.length
                ? [
                    `- **未加入**：${members.missingNames.join('、')}（未匹配平台用户或未登录过平台）`,
                  ]
                : []),
              `- **任务链接**：${this.client.appUrl}/tasks/${root.id}`,
              '',
              '本群会自动同步项目任务及直接子任务的状态；任务结束后保留 7 天并自动解散。',
            ].join('\n'),
          ),
        );
        // 建群卡片已展示当前状态，标记基线，避免对账重复发送。
        row.lastStatuses = {
          ...row.lastStatuses,
          [String(root.id)]: taskStatusKey(root),
        };
        await this.chats.update(row.id, {
          lastStatuses: row.lastStatuses,
        });
      } catch (error) {
        this.logger.warn(
          `项目沟通群创建卡片发送失败（${root.code}）: ${(error as Error).message}`,
        );
      }
      this.logger.log(
        `项目沟通群已创建：${root.code} → chat ${chatId}（${members.users.length} 人，${addedBotIds.length} 个机器人）`,
      );
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.increment({ id: row.id }, 'attempts', 1);
      await this.chats.update(row.id, { state: 'error', lastError: message });
      this.logger.warn(`项目沟通群创建失败（${root.code}）: ${message}`);
    }
  }

  /** 项目相关方按姓名匹配平台用户并解析官方应用 open_id */
  private async resolveMembers(
    official: FeishuBotConfig,
    project: Project,
  ): Promise<ResolvedMembers> {
    const names = projectStakeholderNames(project.resources);
    if (names.length === 0) return { users: [], openIds: [], missingNames: [] };
    const found = await this.users.find({
      where: { name: In(names), enabled: true },
      order: { id: 'ASC' },
    });
    const byName = new Map<string, User>();
    for (const user of found) {
      if (!byName.has(user.name)) byName.set(user.name, user);
    }
    const users: User[] = [];
    const openIds: string[] = [];
    const missingNames: string[] = [];
    const seenOpenIds = new Set<string>();
    for (const name of names) {
      const user = byName.get(name);
      if (!user) {
        missingNames.push(name);
        continue;
      }
      const openId =
        (await this.identities.openIdFor(official.id, user.id)) ??
        user.feishuOpenId;
      if (!openId || seenOpenIds.has(openId)) {
        missingNames.push(name);
        continue;
      }
      seenOpenIds.add(openId);
      users.push(user);
      if (openIds.length < MAX_CHAT_MEMBERS) openIds.push(openId);
    }
    return { users, openIds, missingNames };
  }

  /** 当前执行机器人绑定了独立飞书应用时，一并拉入群（排除官方机器人自身） */
  private async resolveBotIds(
    task: Task,
    official: FeishuBotConfig,
  ): Promise<string[]> {
    if (!task.agentId) return [];
    const config = await this.configs.findEnabledWorkerConfig(task.agentId);
    if (!config || config.appId === official.appId) return [];
    return [config.appId];
  }

  private enqueueTask(taskId: number): void {
    this.pendingTaskIds.add(taskId);
    if (this.drainPromise) return;
    this.drainPromise = this.drain()
      .catch((error) => {
        this.logger.warn(
          `项目沟通群实时状态推送失败: ${(error as Error).message}`,
        );
      })
      .finally(() => {
        this.drainPromise = null;
        const [next] = this.pendingTaskIds;
        if (next !== undefined) this.scheduleDrain(next);
      });
  }

  private scheduleDrain(taskId: number | undefined): void {
    if (taskId === undefined || this.drainPromise) return;
    this.enqueueTask(taskId);
  }

  private async drain(): Promise<void> {
    while (this.pendingTaskIds.size > 0) {
      const ids = [...this.pendingTaskIds];
      this.pendingTaskIds.clear();
      for (const taskId of ids) {
        await this.notifyRealtimeTask(taskId);
      }
    }
  }

  private async notifyRealtimeTask(taskId: number): Promise<void> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) return;
    const rootTaskId = task.parentId ?? task.id;
    const row = await this.chats.findOne({ where: { taskId: rootTaskId } });
    if (!row || row.state !== 'active' || !row.chatId) return;
    if (task.id !== row.taskId && task.parentId !== row.taskId) return;

    await this.withLock(`chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.state !== 'active' || !fresh.chatId) return;
      const official = await this.configs.loadEnabledWithSecrets(
        fresh.officialConfigId,
      );
      if (!official) return;
      const secrets = this.configs.secretsOf(official);
      const root =
        task.id === fresh.taskId
          ? task
          : await this.tasks.findOne({ where: { id: fresh.taskId } });
      if (!root) return;
      await this.markRootFinished(fresh, root);
      await this.syncAgentBot(fresh, root, official, secrets);
      await this.notifyTaskStatus(fresh, task, root, secrets);
    });
  }

  /**
   * 执行机器人可能在建群后才分配，对账时补拉其独立飞书应用。
   * 机器人应用不可用、权限不足或超出群机器人上限时只忽略并记录，不影响状态通知。
   */
  private async syncAgentBot(
    row: FeishuBotProjectChat,
    root: Task,
    official: FeishuBotConfig,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId) return;
    const [botId] = await this.resolveBotIds(root, official);
    if (!botId || row.botIds.includes(botId)) return;
    try {
      await this.client.addChatMembers(
        row.officialConfigId,
        secrets,
        row.chatId,
        [botId],
      );
      const botIds = [...row.botIds, botId];
      await this.chats.update(row.id, { botIds });
      row.botIds = botIds;
    } catch (error) {
      this.logger.warn(
        `项目沟通群补拉执行机器人失败（${root.code}, ${botId}）: ${(error as Error).message}`,
      );
    }
  }

  /** 根任务终态时固定解散时间，所有终态统一保留 7 天 */
  private async markRootFinished(
    row: FeishuBotProjectChat,
    root: Task,
  ): Promise<void> {
    if (root.status !== TaskStatus.FINISHED || row.finishedAt) return;
    const finishedAt = root.acceptedAt ?? root.updatedAt;
    const destroyAfter = new Date(finishedAt.getTime() + DISSOLVE_DELAY_MS);
    await this.chats.update(row.id, { finishedAt, destroyAfter });
    row.finishedAt = finishedAt;
    row.destroyAfter = destroyAfter;
  }

  /** 状态变化才发卡片；根任务终态使用独立结果卡片并锁定群解散提示 */
  private async notifyTaskStatus(
    row: FeishuBotProjectChat,
    task: Task,
    root: Task,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId || row.state !== 'active') return;
    const key = taskStatusKey(task);
    const isRoot = task.id === row.taskId;
    if (isRoot && task.status === TaskStatus.FINISHED) {
      if (row.finishedNotified) return;
      try {
        await this.sendRootFinishedCard(row, root, secrets);
        const lastStatuses = { ...row.lastStatuses, [String(root.id)]: key };
        await this.chats.update(row.id, {
          lastStatuses,
          finishedNotified: true,
          lastError: null,
        });
        row.lastStatuses = lastStatuses;
        row.finishedNotified = true;
      } catch (error) {
        const message = (error as Error).message;
        await this.chats.update(row.id, { lastError: message });
        this.logger.warn(
          `项目沟通群终态卡片发送失败（${root.code}）: ${message}`,
        );
      }
      return;
    }
    if (row.lastStatuses[String(task.id)] === key) return;
    try {
      const agent = await this.agentName(task);
      await this.client.sendCard(
        row.officialConfigId,
        secrets,
        'chat_id',
        row.chatId,
        markdownCard(
          [
            `**[${isRoot ? '项目任务' : '子任务'}状态更新]** ${task.code}`,
            '',
            `- **项目任务**：${root.code}`,
            `- **${isRoot ? '当前任务' : '子任务'}**：${task.title}`,
            `- **状态**：${
              row.lastStatuses[String(task.id)]
                ? `${row.lastStatuses[String(task.id)]} → `
                : ''
            }${taskStatusText(task)}`,
            `- **执行方**：${agent}`,
            `- **任务链接**：${this.client.appUrl}/tasks/${task.id}`,
          ].join('\n'),
        ),
      );
      const lastStatuses = { ...row.lastStatuses, [String(task.id)]: key };
      await this.chats.update(row.id, { lastStatuses, lastError: null });
      row.lastStatuses = lastStatuses;
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.update(row.id, { lastError: message });
      this.logger.warn(`项目沟通群状态推送失败（${task.code}）: ${message}`);
    }
  }

  private async sendRootFinishedCard(
    row: FeishuBotProjectChat,
    root: Task,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    const result = (root.result ?? '').trim();
    const summary = result
      ? `\n\n${result.slice(0, 1200)}${result.length > 1200 ? '\n…（完整内容见任务详情）' : ''}`
      : '';
    const destroyText = row.destroyAfter
      ? `该群将于 **${formatBeijing(row.destroyAfter)}** 自动解散，任务记录与交付文档不受影响。`
      : '该群将在任务结束 7 天后自动解散，任务记录与交付文档不受影响。';
    await this.client.sendCard(
      row.officialConfigId,
      secrets,
      'chat_id',
      row.chatId!,
      markdownCard(
        [
          `**[项目任务已结束]** ${root.code} ${root.subStatus}`,
          `- **项目**：${row.projectName}`,
          `- **任务**：${root.title}`,
          `- **状态**：${taskStatusText(root)}`,
          `- **任务链接**：${this.client.appUrl}/tasks/${root.id}`,
          summary,
          '',
          destroyText,
        ].join('\n'),
      ),
    );
  }

  private async agentName(task: Task): Promise<string> {
    if (!task.agentId) return '未分配';
    const worker = await this.workers.findOne({
      where: { id: task.agentId },
      select: { id: true, name: true },
    });
    return worker?.name ?? `#${task.agentId}`;
  }

  /** 任务/项目删除后尽力解散；官方机器人不可用时保留绑定等待恢复后重试 */
  private async destroyMissingGroup(row: FeishuBotProjectChat): Promise<void> {
    if (row.state === 'destroyed') return;
    await this.withLock(`chat:${row.id}`, async () => {
      const fresh = await this.chats.findOne({ where: { id: row.id } });
      if (!fresh || fresh.state === 'destroyed') return;
      if (!fresh.chatId) {
        await this.chats.update(fresh.id, {
          state: 'destroyed',
          lastError: '任务或项目已删除',
        });
        return;
      }
      const official = await this.configs.loadEnabledWithSecrets(
        fresh.officialConfigId,
      );
      if (!official) {
        await this.chats.update(fresh.id, {
          lastError: '任务或项目已删除，但官方机器人不可用，暂无法解散群',
        });
        return;
      }
      await this.dissolve(fresh, this.configs.secretsOf(official));
    });
  }

  private async dissolve(
    row: FeishuBotProjectChat,
    secrets: FeishuBotSecrets,
  ): Promise<void> {
    if (!row.chatId) {
      await this.chats.update(row.id, { state: 'destroyed' });
      return;
    }
    try {
      await this.client.dissolveChat(row.officialConfigId, secrets, row.chatId);
      await this.chats.update(row.id, {
        state: 'destroyed',
        lastError: null,
      });
      this.logger.log(`项目沟通群已解散：chat ${row.chatId}`);
    } catch (error) {
      const message = (error as Error).message;
      await this.chats.update(row.id, { lastError: message });
      this.logger.warn(`项目沟通群解散失败（chat ${row.chatId}）: ${message}`);
    }
  }

  /** 同一群串行处理实时事件与定时对账，避免重复卡片和重复建群 */
  private async withLock(key: string, run: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    this.locks.set(key, tail);
    await previous;
    try {
      await run();
    } finally {
      release();
      if (this.locks.get(key) === tail) this.locks.delete(key);
    }
  }
}

function taskStatusKey(task: Task): string {
  return `${task.status}-${task.subStatus}`;
}

function taskStatusText(task: Task): string {
  return `${task.status}-${task.subStatus}`;
}

function formatBeijing(value: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter } from 'events';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import { TaskStatus, WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import {
  OpencodeEvent,
  OpencodeEventHub,
} from '../executors/opencode-event-hub.service';
import { FeishuService } from '../feishu/feishu.service';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';

/** 活跃状态（实时流持续到任务离开该集合） */
const STREAMING_STATUSES = [TaskStatus.DISPATCHED, TaskStatus.EXECUTING];

/** 终态快照预留：实时输出缓冲在进程内保留（P1 不做 TTL 清理，重启后由任务历史承担） */

/** 每个任务的实时输出缓冲（行数组 + 变更事件） */
interface LiveTaskStream {
  lines: string[];
  emitter: EventEmitter;
}

/**
 * 任务派发执行引擎：机器人（runtime=opencode）在执行器上干活。
 * 链路：mkdir 工位 → 建 opencode 会话（title/model/location）→ 发 prompt（角色+技能+输入输出）
 * → 订阅执行器事件流（按 sessionId 路由）→ 终态（execution.completed）取最终回复 → 「待验收」+ 通知责任人。
 */
@Injectable()
export class TaskDispatchService implements OnModuleInit {
  private readonly logger = new Logger(TaskDispatchService.name);

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly workersService: WorkersService,
    private readonly eventHub: OpencodeEventHub,
    private readonly feishuService: FeishuService,
  ) {}

  /** opencodeSessionId → taskId 路由缓存（未命中回库查） */
  private readonly sessionRoutes = new Map<string, number>();

  /** taskId → 实时输出缓冲 */
  private readonly live = new Map<number, LiveTaskStream>();

  /** taskId → 会话文本增量累积（按 assistantMessageID 分组；完成后作为 result 来源） */
  private readonly textBuffers = new Map<number, Map<string, string>>();

  /** 已提醒过权限请求的任务（避免重复通知） */
  private readonly permissionNotified = new Set<number>();

  onModuleInit(): void {
    this.eventHub.onEvent((event) => {
      void this.handleEvent(event);
    });
  }

  /**
   * 派发：待调度/执行中的任务（重新派发）→ 建工位 → 建会话 → 发 prompt。
   * 成功后任务标「执行中」并绑定会话；子任务由调度确认流程批量调用。
   */
  async dispatch(taskId: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (
      ![TaskStatus.PENDING_SCHEDULE, TaskStatus.EXECUTING].includes(task.status)
    ) {
      throw new NotFoundException(
        `任务 ${task.code} 当前状态「${task.status}」不可派发`,
      );
    }
    if (!task.agentId)
      throw new NotFoundException(`任务 ${task.code} 未分配机器人`);
    const worker = await this.workers.findOne({ where: { id: task.agentId } });
    if (!worker || !worker.enabled) {
      throw new NotFoundException(`机器人 #${task.agentId} 不存在或已停用`);
    }
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new NotFoundException('仅支持 runtime=opencode 的机器人派发');
    }
    if (!worker.executorId || !worker.providerId || !worker.modelId) {
      throw new NotFoundException('机器人未配置完整（执行器/供应商/模型）');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor || !executor.online) {
      throw new NotFoundException(`执行器 #${worker.executorId} 离线或不存在`);
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) {
      throw new NotFoundException('未配置 WORKER_BASE_DIR，无法确定工位目录');
    }
    const client = new OpencodeClient(executor);
    // 确保事件流订阅在（覆盖服务重启/执行器刚上线等场景）
    this.eventHub.ensureConnected(executor);

    // 1. 工位目录（幂等创建；路径单引号包裹防注入）
    await client.shell(`mkdir -p '${workdir}'`);

    // 2. 重新派发时先中断旧会话
    if (task.opencodeSessionId) {
      await client
        .interrupt(task.opencodeSessionId)
        .catch((e: Error) =>
          this.logger.warn(
            `旧会话 ${task.opencodeSessionId} 中断失败: ${e.message}`,
          ),
        );
    }

    // 3. 建会话（title=编号+标题；location=工位）
    const session = await client.createSession({
      title: `${task.code} ${task.title}`,
      model: { id: worker.modelId, providerID: worker.providerId },
      location: { directory: workdir },
    });

    // 4. 落派发状态并绑定会话
    task.status = TaskStatus.DISPATCHED;
    task.executorId = executor.id;
    task.opencodeSessionId = session.id;
    await this.tasks.save(task);
    await this.addEvent(
      task.id,
      '操作',
      `派发给「${worker.name}」（执行器：${executor.name}，会话：${session.id}）`,
      operator,
      { executorId: executor.id, sessionId: session.id },
    );
    this.sessionRoutes.set(`${executor.id}:${session.id}`, task.id);
    this.pushLine(task.id, `▶ 已派发给 ${worker.name}（会话 ${session.id}）`);

    // 5. 发 prompt（角色定义 + 技能内联 + 任务输入/输出要求）
    const text = this.buildPrompt(task, worker);
    await client.prompt(session.id, { text });
    this.pushLine(task.id, '▶ 任务指令已下发');

    // 6. 执行中
    task.status = TaskStatus.EXECUTING;
    const saved = await this.tasks.save(task);
    await this.addEvent(task.id, '状态变更', '状态变更：已派发 → 执行中', null);
    return saved;
  }

  /** 中断执行（会话 interrupt + 事件；任务保持执行中，可重新派发或取消） */
  async interrupt(taskId: number, operator: string | null): Promise<Task> {
    const task = await this.mustFind(taskId);
    if (task.status !== TaskStatus.EXECUTING) {
      throw new NotFoundException(`任务 ${task.code} 当前不在执行中`);
    }
    if (task.opencodeSessionId && task.executorId) {
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (executor) {
        await new OpencodeClient(executor)
          .interrupt(task.opencodeSessionId)
          .catch((e: Error) =>
            this.logger.warn(
              `会话 ${task.opencodeSessionId} 中断失败: ${e.message}`,
            ),
          );
      }
    }
    this.pushLine(taskId, '■ 已人工中断');
    await this.addEvent(taskId, '操作', '人工中断执行', operator);
    return this.mustFind(taskId);
  }

  /** 任务详情附带的实时输出行（历史页/详情兜底） */
  liveLines(taskId: number): string[] {
    return this.live.get(taskId)?.lines ?? [];
  }

  /**
   * 任务实时输出流（SSE）：先推已有行，随后增量推送执行器事件行与状态；
   * 任务离开活跃状态后完成流（终态快照保留 TTL 供晚订阅）。
   */
  stream(taskId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let sent = 0;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearInterval(poll);
        off();
        subscriber.complete();
      };
      const pushPending = () => {
        const buf = this.live.get(taskId);
        if (!buf) return;
        while (sent < buf.lines.length) {
          subscriber.next({ data: { line: buf.lines[sent] } });
          sent++;
        }
      };
      const entry =
        this.live.get(taskId) ??
        this.live
          .set(taskId, { lines: [], emitter: new EventEmitter() })
          .get(taskId)!;
      const onLine = () => pushPending();
      entry.emitter.on('line', onLine);
      const off = () => entry.emitter.off('line', onLine);
      pushPending();

      // 兜底轮询任务状态：离开活跃状态（待验收等）即完成流
      const poll = setInterval(() => {
        void this.tasks
          .findOne({ where: { id: taskId }, select: { status: true } })
          .then((task) => {
            if (done) return;
            subscriber.next({ data: { status: task?.status ?? null } });
            if (!task || !STREAMING_STATUSES.includes(task.status)) finish();
          })
          .catch(() => finish());
      }, 2000);
      // 保守兜底：30 分钟未结束自动断流（前端可重连）
      const maxDuration = setTimeout(finish, 30 * 60_000);
      return () => {
        done = true;
        clearInterval(poll);
        clearTimeout(maxDuration);
        off();
      };
    });
  }

  /** 执行器事件入口：按 sessionId 路由到任务并转成终端行 */
  private async handleEvent(event: OpencodeEvent): Promise<void> {
    const sessionId = this.sessionIdOf(event);
    if (!sessionId) return;
    const taskId = await this.resolveTask(event.executorId, sessionId);
    if (!taskId) return;
    const data = (event.data ?? {}) as Record<string, unknown>;
    const str = (key: string): string =>
      typeof data[key] === 'string' ? data[key] : '';
    const messageId = str('assistantMessageID');

    switch (true) {
      case event.type === 'session.execution.started': {
        this.pushLine(taskId, '▶ 会话开始执行');
        break;
      }
      case event.type === 'session.step.started': {
        const model = data.model as
          { providerID?: string; id?: string } | undefined;
        this.pushLine(
          taskId,
          `● step agent=${str('agent') || '?'} model=${model ? `${model.providerID}/${model.id}` : '?'}`,
        );
        break;
      }
      case event.type === 'session.tool.input.started': {
        this.pushLine(taskId, `🔧 调用工具 ${str('name') || '?'}`);
        break;
      }
      case event.type === 'session.tool.success': {
        this.pushLine(taskId, '✓ 工具执行成功');
        break;
      }
      case event.type === 'session.tool.failed': {
        this.pushLine(taskId, '✗ 工具执行失败');
        break;
      }
      case event.type === 'session.text.started': {
        this.bufferOf(taskId).set(messageId, '');
        break;
      }
      case event.type === 'session.text.delta': {
        const buffers = this.bufferOf(taskId);
        buffers.set(messageId, (buffers.get(messageId) ?? '') + str('delta'));
        break;
      }
      case event.type === 'session.text.ended': {
        const text = this.bufferOf(taskId).get(messageId)?.trim();
        if (text) {
          const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
          this.pushLine(taskId, `💬 ${clipped.replace(/\n/g, '\n💬 ')}`);
        }
        break;
      }
      case event.type === 'session.step.failed': {
        const error = data.error as { message?: string } | undefined;
        this.pushLine(taskId, `✗ step-failed ${error?.message ?? '未知错误'}`);
        break;
      }
      case event.type.startsWith('permission'): {
        this.pushLine(taskId, `⚠ 权限请求：${event.type}`);
        await this.notifyPermission(taskId, event.type);
        break;
      }
      case event.type === 'session.execution.succeeded':
      case event.type === 'session.execution.completed': {
        await this.finalizeSuccess(taskId);
        break;
      }
      case event.type === 'session.execution.failed': {
        const error = data.error as
          { type?: string; message?: string } | undefined;
        this.pushLine(taskId, `✗ 执行失败：${error?.message ?? event.type}`);
        await this.addEvent(
          taskId,
          '系统',
          `会话执行失败：${error?.type ?? ''} ${error?.message ?? ''}`.trim(),
          null,
        );
        break;
      }
      default:
        break;
    }
  }

  private bufferOf(taskId: number): Map<string, string> {
    let buffers = this.textBuffers.get(taskId);
    if (!buffers) {
      buffers = new Map();
      this.textBuffers.set(taskId, buffers);
    }
    return buffers;
  }

  /** 会话执行完成：取累积文本（兜底读消息）→ 落 result → 待验收 + 通知责任人 */
  private async finalizeSuccess(taskId: number): Promise<void> {
    const task = await this.mustFind(taskId);
    if (task.status !== TaskStatus.EXECUTING) return;
    const buffers = this.textBuffers.get(taskId);
    const accumulated = [...(buffers?.values() ?? [])]
      .map((t) => t.trim())
      .filter(Boolean)
      .join('\n\n');
    let resultText: string | null = accumulated || null;
    if (!resultText && task.executorId && task.opencodeSessionId) {
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (executor) {
        resultText = await this.fetchLastAssistantText(
          new OpencodeClient(executor),
          task.opencodeSessionId,
        );
      }
    }
    task.status = TaskStatus.PENDING_ACCEPT;
    task.result = resultText ?? task.result;
    await this.tasks.save(task);
    this.pushLine(taskId, '✔ 执行完成，待验收');
    await this.addEvent(
      taskId,
      '状态变更',
      '状态变更：执行中 → 待验收（会话完成）',
      null,
    );
    await this.notifyOwner(
      task,
      `任务待验收：${task.code} ${task.title}`,
      '机器人已完成执行，请到平台验收产出',
    );
  }

  /** 消息兜底：列表找最后一条 assistant → 取详情 content 文本分段 */
  private async fetchLastAssistantText(
    client: OpencodeClient,
    sessionId: string,
  ): Promise<string | null> {
    interface ListMessage {
      id?: string;
      type?: string;
      text?: string;
    }
    type Detail = { content?: Array<{ type?: string; text?: string }> };
    try {
      const json = (await client.messages(sessionId)) as
        ListMessage[] | { data?: ListMessage[] };
      const list: ListMessage[] = Array.isArray(json)
        ? json
        : (json.data ?? []);
      // 列表项 text 可能为空：取最后一条 assistant 的详情
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        if (m?.type !== 'assistant' || !m.id) continue;
        const raw = (await client.message(sessionId, m.id)) as
          Detail | { data?: Detail };
        const detail = (raw as { data?: Detail }).data ?? (raw as Detail);
        const text = (detail.content ?? [])
          .filter((p) => p.type === 'text' && p.text?.trim())
          .map((p) => p.text!.trim())
          .join('\n\n');
        if (text) return text;
      }
    } catch (e) {
      this.logger.warn(
        `取会话 ${sessionId} 最终回复失败: ${(e as Error).message}`,
      );
    }
    return null;
  }

  /**
   * 执行中任务兜底对账（每 2 分钟）：事件流漏收（服务重启/断线期间完成）时，
   * 直接查会话 outcome 补推进「待验收」，并从消息详情取回产出。
   */
  @Cron('20 */2 * * * *')
  async reconcileExecuting(): Promise<void> {
    const running = await this.tasks.find({
      where: { status: TaskStatus.EXECUTING },
      select: { id: true, executorId: true, opencodeSessionId: true },
    });
    for (const task of running) {
      if (!task.executorId || !task.opencodeSessionId) continue;
      const executor = await this.executors.findOne({
        where: { id: task.executorId },
      });
      if (!executor?.online) continue;
      try {
        const info = await new OpencodeClient(executor).session(
          task.opencodeSessionId,
        );
        if (info.outcome === 'succeeded') {
          this.pushLine(task.id, '↻ 对账补偿：会话已完成，补推进状态');
          await this.finalizeSuccess(task.id);
        } else if (info.outcome === 'failed') {
          if (this.failedReconciled.has(task.id)) continue;
          this.failedReconciled.add(task.id);
          this.pushLine(task.id, '↻ 对账补偿：会话执行失败');
          await this.addEvent(
            task.id,
            '系统',
            '对账补偿：会话执行失败（可中断后重新派发）',
            null,
          );
        }
      } catch (e) {
        this.logger.debug(`任务 #${task.id} 对账失败: ${(e as Error).message}`);
      }
    }
  }

  /** 对账已记录失败的会话（避免重复事件） */
  private readonly failedReconciled = new Set<number>();

  /** prompt 组装：角色定义 + 技能（内联 MD）+ 任务（编号/标题/类型/输入/输出要求） */
  private buildPrompt(task: Task, worker: Worker): string {
    const sections: string[] = [];
    if (worker.prompt?.trim()) sections.push(worker.prompt.trim());
    if (worker.skills?.length) {
      sections.push(
        `# 技能\n\n${worker.skills
          .map((s) => `## 技能：${s.name}\n\n${s.content}`)
          .join('\n\n')}`,
      );
    }
    sections.push(
      [
        '# 任务',
        '',
        `- 编号：${task.code}`,
        `- 标题：${task.title}`,
        `- 类型：${task.type}`,
        task.description?.trim()
          ? `\n# 任务描述\n\n${task.description.trim()}`
          : '',
        task.input?.trim() ? `\n# 任务输入\n\n${task.input.trim()}` : '',
        task.outputSpec?.trim()
          ? `\n# 输出要求\n\n${task.outputSpec.trim()}`
          : '',
      ].join('\n'),
    );
    return sections.join('\n\n---\n\n');
  }

  /** 事件 data 里的会话 id（各事件统一放 data.sessionID） */
  private sessionIdOf(event: OpencodeEvent): string | null {
    const data = event.data as { sessionID?: string } | null;
    return data?.sessionID ?? null;
  }

  /** sessionId → 任务（缓存未命中回库查并回填） */
  private async resolveTask(
    executorId: number,
    sessionId: string,
  ): Promise<number | null> {
    const key = `${executorId}:${sessionId}`;
    const cached = this.sessionRoutes.get(key);
    if (cached) return cached;
    const task = await this.tasks.findOne({
      where: { executorId, opencodeSessionId: sessionId },
      select: { id: true },
    });
    if (task) this.sessionRoutes.set(key, task.id);
    return task?.id ?? null;
  }

  /** 权限请求：记事件 + 通知责任人（每任务只通知一次） */
  private async notifyPermission(taskId: number, type: string): Promise<void> {
    if (this.permissionNotified.has(taskId)) return;
    this.permissionNotified.add(taskId);
    const task = await this.mustFind(taskId);
    await this.addEvent(
      taskId,
      '系统',
      `会话请求权限（${type}），请在平台批复`,
      null,
    );
    await this.notifyOwner(
      task,
      `任务等待授权：${task.code} ${task.title}`,
      '执行中会话请求工具权限，请到任务详情批复',
    );
  }

  /** 责任人飞书卡片（失败仅告警） */
  private async notifyOwner(
    task: Task,
    title: string,
    desc: string,
  ): Promise<void> {
    if (!task.agentId) return;
    try {
      const worker = await this.workers.findOne({
        where: { id: task.agentId },
      });
      if (!worker) return;
      const openId = await this.workersService.ownerOpenId(worker);
      if (!openId) return;
      await this.feishuService.sendUserCard(openId, {
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: `**${title}**\n**说明**：${desc}`,
            },
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '打开任务详情' },
                type: 'primary',
                url: `{APP_URL}/tasks/${task.id}`,
              },
            ],
          },
        ],
      });
    } catch (e) {
      this.logger.warn(
        `任务 ${task.code} 责任人通知失败: ${(e as Error).message}`,
      );
    }
  }

  /** 追加一行实时输出并广播 */
  private pushLine(taskId: number, line: string): void {
    const entry =
      this.live.get(taskId) ??
      this.live
        .set(taskId, { lines: [], emitter: new EventEmitter() })
        .get(taskId)!;
    entry.lines.push(line);
    entry.emitter.emit('line');
    // 终态后 TTL 清理由 stream 轮询触发；此处对超长缓冲截断
    if (entry.lines.length > 2000) entry.lines.splice(0, 500);
  }

  async addEvent(
    taskId: number,
    type: string,
    content: string,
    operator: string | null,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        taskId,
        type,
        content,
        operator,
        meta: meta ?? null,
      }),
    );
  }

  async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }
}

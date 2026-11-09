import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { MessageEvent } from '@nestjs/common';
import { Observable, type Subscription } from 'rxjs';
import { Repository } from 'typeorm';
import type { User } from '../auth/user.entity';
import { WorkerRuntime, WorkerRole } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { Worker } from './worker.entity';
import { WorkerDebugService } from './worker-debug.service';
import type {
  WorkerDebugAttachment,
  WorkerDebugModelCatalog,
  WorkerDebugModelSelection,
  WorkerDebugSnapshot,
} from './worker-debug.types';
import { WorkerEnvironmentService } from './worker-environment.service';
import { WorkerSkillCatalogService } from './worker-skill-catalog.service';
import { WorkersService } from './workers.service';
import { ensureWorkerSequenceFloor } from './system-workers.service';
import {
  buildPersonalAgentPrompt,
  buildPersonalAgentFirstPrompt,
  isDeprecatedPersonalAgentSkill,
  PERSONAL_AGENT_SKILL_PATHS,
} from './personal-agent';
import {
  agentTokenShell,
  shellQuote,
  workMcpConfigShell,
  workerEnvShell,
} from './worker-env';

/** 工作台「我的 AGENT」可用信息（对外只暴露必要字段） */
export interface PersonalAgentView {
  id: number;
  name: string;
  intro: string | null;
  avatarUrl: string | null;
  executorId: number | null;
  providerId: string | null;
  modelId: string | null;
  variant: string | null;
  enabled: boolean;
  personalAgentUserId: number | null;
}

export interface PersonalAgentInfo {
  /** 个人 AGENT 机器人（未创建成功时为 null） */
  worker: PersonalAgentView | null;
  /** 是否可立即对话（已创建且执行器在线、模型配置完整） */
  available: boolean;
  /** 不可用原因 */
  reason: string | null;
}

/** 个人 AGENT 对话发送选项 */
export interface PersonalAgentSendOptions {
  /** 当前工作台选中任务：每个任务使用独立的 opencode 会话 */
  taskId?: number | null;
  /**
   * 自定义会话范围（详情页使用）。
   * 优先生效，未提供时按 taskId 推导任务/通用会话。
   */
  scope?: string | null;
  /** 当前页面上下文（不写入用户气泡，仅作为本轮提示词前缀） */
  taskContext?: string | null;
  /** 随消息发送的附件（已上传文件的公开地址） */
  files?: WorkerDebugAttachment[];
}

/** 首次准备工位超时保护（正常是一次 shell 调用，极快） */
const PREPARE_TIMEOUT_MS = 30_000;

/**
 * 个人 AI AGENT：每个用户唯一的 AI 代理机器人。
 *
 * - 真人机器人（workers.humanUserId）继续负责「我作为执行者」；
 * - 个人 AGENT（workers.personalAgentUserId）负责工作台「我的 AGENT」对话，
 *   通过 platform .md 接口与技能代表用户操作任务；
 * - 对话复用机器人调试会话（worker_debug_sessions），按「用户 + 机器人」绑定多轮上下文。
 */
@Injectable()
export class PersonalAgentsService {
  private readonly logger = new Logger(PersonalAgentsService.name);
  /** 当前进程内已准备好令牌文件的个人 AGENT */
  private readonly prepared = new Set<number>();
  /** 当前进程内已安装默认技能的个人 AGENT */
  private readonly skillsInstalled = new Set<number>();
  /** 当前进程内已启动环境初始化的个人 AGENT */
  private readonly envStarted = new Set<number>();
  /** 找不到可用执行器模板时的短期负缓存，避免工作台轮询反复查库 */
  private readonly templateUnavailableUntil = new Map<number, number>();

  private readonly apiUrl: string;
  /** 平台对外地址（工位 MCP 配置使用） */
  private readonly appUrl: string;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
    private readonly debug: WorkerDebugService,
    private readonly environment: WorkerEnvironmentService,
    private readonly skillCatalog: WorkerSkillCatalogService,
    config: ConfigService,
  ) {
    this.apiUrl =
      config.get<string>('API_URL')?.trim() || 'http://localhost:3100/api';
    this.appUrl = (
      config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/+$/, '');
  }

  /** 按归属用户查个人 AGENT */
  findForUser(userId: number): Promise<Worker | null> {
    if (userId <= 0) return Promise.resolve(null);
    return this.workers.findOne({ where: { personalAgentUserId: userId } });
  }

  /**
   * 我的 AI 会话范围：每个任务独立 session，未选中任务时使用通用会话。
   * 机器人调试页仍使用 debug scope，两者上下文互不影响。
   */
  private scopeOf(taskId?: number | null, scope?: string | null): string {
    const custom = scope?.trim();
    if (custom) return custom;
    const id = Number(taskId);
    return Number.isInteger(id) && id > 0 ? `agent:task:${id}` : 'agent:global';
  }

  /**
   * 确保用户有个人 AGENT（没有则按系统调度机器人/首个可用机器人复制执行器配置创建）。
   * 找不到可用的执行器模板时返回 null，调用方可展示引导文案。
   */
  async ensureForUser(
    user: Pick<User, 'id' | 'name' | 'enabled'> & {
      avatarUrl?: string | null;
    },
  ): Promise<Worker | null> {
    const existing = await this.findForUser(user.id);
    if (existing) return existing;

    const blockedUntil = this.templateUnavailableUntil.get(user.id) ?? 0;
    if (Date.now() < blockedUntil) return null;

    const template = await this.pickTemplate();
    if (!template) {
      // 平台还没有任何可用的 opencode 机器人配置：60 秒内不重复扫库
      this.templateUnavailableUntil.set(user.id, Date.now() + 60_000);
      return null;
    }

    const name = await this.personalAgentName(user);
    await ensureWorkerSequenceFloor(this.workers);
    const worker = this.workers.create({
      name,
      intro: `个人 AI AGENT：代表「${user.name}」在工作台操作任务`,
      avatarUrl: user.avatarUrl ?? null,
      role: WorkerRole.WORKER,
      runtime: WorkerRuntime.OPENCODE,
      executorId: template.executorId,
      providerId: template.providerId,
      modelId: template.modelId,
      variant: template.variant,
      prompt: buildPersonalAgentPrompt(user.name, this.apiUrl),
      skills: null,
      standards: null,
      taskDefs: null,
      humanUserId: null,
      humanUserName: null,
      personalAgentUserId: user.id,
      ownerUserId: user.id,
      ownerName: user.name,
      enabled: user.enabled !== false,
    });
    try {
      const saved = await this.workers.save(worker);
      if (saved.id >= 1000) {
        this.logger.log(
          `已为用户「${user.name}」#${user.id} 创建个人 AGENT #${saved.id}（${saved.name}）`,
        );
        this.templateUnavailableUntil.delete(user.id);
        return saved;
      }
      // 理论上 ensureWorkerSequenceFloor 已保证；兜底避免占用系统 ID 段
      await this.workers.delete({ id: saved.id });
      this.logger.warn(
        `个人 AGENT 落到了系统 ID 段（#${saved.id}），已回滚；稍后重试`,
      );
    } catch (error) {
      // 并发创建时唯一索引冲突：重新读取已存在的记录
      const raced = await this.findForUser(user.id);
      if (raced) return raced;
      this.logger.warn(
        `创建个人 AGENT 失败（${user.name}）: ${(error as Error).message}`,
      );
    }
    return null;
  }

  /** 工作台头部/「我的 AGENT」TAB 的可用状态 */
  async infoForUser(
    user: Pick<User, 'id' | 'name' | 'enabled'> & {
      avatarUrl?: string | null;
    },
  ): Promise<PersonalAgentInfo> {
    let worker: Worker | null = null;
    try {
      worker = await this.ensureForUser(user);
    } catch (error) {
      return {
        worker: null,
        available: false,
        reason: `个人 AGENT 创建失败：${(error as Error).message}`,
      };
    }
    if (!worker) {
      return {
        worker: null,
        available: false,
        reason:
          '平台尚未配置可用的 AI 执行器/模型，无法创建个人 AGENT；请先在「任务 → 执行器」完成配置。',
      };
    }
    return this.describe(worker);
  }

  /** 校验并准备个人 AGENT 工位（写入令牌文件） */
  async requireChatAgent(user: User): Promise<{
    worker: Worker;
    executor: Executor;
    workdir: string;
  }> {
    const worker = await this.ensureForUser(user);
    if (!worker) {
      throw new ServiceUnavailableException(
        '平台尚未配置可用的 AI 执行器/模型，无法创建个人 AGENT',
      );
    }
    const info = await this.describe(worker);
    if (!info.available) {
      throw new ServiceUnavailableException(info.reason ?? '个人 AGENT 不可用');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId! },
    });
    const workdir = this.workersService.workdirOf(worker.id);
    if (!executor || !workdir) {
      throw new ServiceUnavailableException('个人 AGENT 工位或执行器不可用');
    }
    await this.prepareWorkdir(worker, executor, workdir);
    // 后台补齐 AGENTS.md / 技能（失败不影响对话，首轮 prompt 已内置角色与任务接口）
    void this.bootstrapEnvironment(worker);
    return { worker, executor, workdir };
  }

  /** 我的 AGENT 对话快照（按任务隔离会话） */
  async snapshot(
    user: User,
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugSnapshot> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.snapshot(user.id, worker.id, this.scopeOf(taskId, scope));
  }

  /** 我的 AGENT 对话 SSE（按任务/详情页隔离会话） */
  stream(
    user: User,
    taskId?: number | null,
    scope?: string | null,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let inner: Subscription | null = null;
      this.requireChatAgent(user)
        .then(({ worker }) => {
          if (closed) return;
          inner = this.debug
            .stream(user.id, worker.id, this.scopeOf(taskId, scope))
            .subscribe(subscriber);
        })
        .catch((error: Error) => {
          if (!closed) subscriber.error(error);
        });
      return () => {
        closed = true;
        inner?.unsubscribe();
      };
    });
  }

  /** 发送一轮消息；taskContext 仅进入本轮提示词，不写入用户气泡 */
  async send(
    user: User,
    content: string,
    options?: PersonalAgentSendOptions,
  ): Promise<WorkerDebugSnapshot> {
    const { worker, workdir } = await this.requireChatAgent(user);
    return this.debug.send(user.id, worker.id, content, {
      scope: this.scopeOf(options?.taskId, options?.scope),
      firstPrompt: buildPersonalAgentFirstPrompt(
        worker.prompt,
        this.apiUrl,
        user.name ?? worker.name,
        workdir,
      ),
      promptPrefix: options?.taskContext?.trim() || undefined,
      files: options?.files,
    });
  }

  /** 我的 AGENT：可切换的模型与思考等级清单 */
  async models(
    user: User,
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugModelCatalog> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.models(user.id, worker.id, this.scopeOf(taskId, scope));
  }

  /** 我的 AGENT：切换模型/思考等级 */
  async setModel(
    user: User,
    input: WorkerDebugModelSelection,
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugSnapshot> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.setModel(
      user.id,
      worker.id,
      input,
      this.scopeOf(taskId, scope),
    );
  }

  async interrupt(
    user: User,
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugSnapshot> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.interrupt(
      user.id,
      worker.id,
      this.scopeOf(taskId, scope),
    );
  }

  async replyQuestion(
    user: User,
    questionId: string,
    input: { answers?: string[][]; reject?: boolean },
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugSnapshot> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.replyQuestion(
      user.id,
      worker.id,
      questionId,
      input,
      this.scopeOf(taskId, scope),
    );
  }

  async reset(
    user: User,
    taskId?: number | null,
    scope?: string | null,
  ): Promise<WorkerDebugSnapshot> {
    const { worker } = await this.requireChatAgent(user);
    return this.debug.reset(user.id, worker.id, this.scopeOf(taskId, scope));
  }

  /** 可用性描述（不修改数据库） */
  private async describe(worker: Worker): Promise<PersonalAgentInfo> {
    const view = this.toView(worker);
    if (!worker.enabled) {
      return { worker: view, available: false, reason: '个人 AGENT 已停用' };
    }
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      return {
        worker: view,
        available: false,
        reason: '个人 AGENT 不是 opencode 运行时',
      };
    }
    if (
      !worker.executorId ||
      !worker.providerId?.trim() ||
      !worker.modelId?.trim()
    ) {
      return {
        worker: view,
        available: false,
        reason: '个人 AGENT 未配置执行器、供应商或模型',
      };
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor || !executor.enabled) {
      return {
        worker: view,
        available: false,
        reason: '个人 AGENT 的执行器不存在或已停用',
      };
    }
    if (!executor.online) {
      return {
        worker: view,
        available: false,
        reason: `个人 AGENT 的执行器「${executor.name}」离线`,
      };
    }
    if (!this.workersService.workdirOf(worker.id)) {
      return {
        worker: view,
        available: false,
        reason: '未配置 WORKER_BASE_DIR，个人 AGENT 无法创建工位',
      };
    }
    return { worker: view, available: true, reason: null };
  }

  /** 对外视图：不返回 prompt/skills/token 等大字段与敏感字段 */
  private toView(worker: Worker): PersonalAgentView {
    return {
      id: worker.id,
      name: worker.name,
      intro: worker.intro,
      avatarUrl: worker.avatarUrl,
      executorId: worker.executorId,
      providerId: worker.providerId,
      modelId: worker.modelId,
      variant: worker.variant,
      enabled: worker.enabled,
      personalAgentUserId: worker.personalAgentUserId,
    };
  }

  /** 选取可复制的执行器配置：优先系统调度机器人，其次首个启用且在线的工作者 */
  private async pickTemplate(): Promise<{
    executorId: number;
    providerId: string;
    modelId: string;
    variant: string | null;
  } | null> {
    const workers = await this.workers.find({
      where: { enabled: true, runtime: WorkerRuntime.OPENCODE },
      order: { id: 'ASC' },
    });
    const candidates = workers.filter(
      (worker) =>
        !worker.personalAgentUserId &&
        !worker.humanUserId &&
        Boolean(worker.executorId) &&
        Boolean(worker.providerId?.trim()) &&
        Boolean(worker.modelId?.trim()),
    );
    if (candidates.length === 0) return null;

    const executorIds = [
      ...new Set(candidates.map((worker) => worker.executorId!)),
    ];
    const executors = await this.executors.find({
      where: executorIds.map((id) => ({ id })),
    });
    const online = new Set(
      executors
        .filter((executor) => executor.enabled && executor.online)
        .map((executor) => executor.id),
    );
    const preferred =
      candidates.find(
        (worker) =>
          worker.systemKey === 'scheduler' && online.has(worker.executorId!),
      ) ?? candidates.find((worker) => online.has(worker.executorId!));
    const chosen = preferred ?? candidates[0];
    return {
      executorId: chosen.executorId!,
      providerId: chosen.providerId!.trim(),
      modelId: chosen.modelId!.trim(),
      variant: chosen.variant?.trim() || null,
    };
  }

  /** 个人 AGENT 展示名：跟随用户名，冲突时稳定追加用户 ID */
  private async personalAgentName(
    user: Pick<User, 'id' | 'name'>,
  ): Promise<string> {
    const suffix = '的AGENT';
    const base = `${(user.name || `用户#${user.id}`).slice(
      0,
      100 - suffix.length,
    )}${suffix}`;
    const exists = await this.workers.findOne({ where: { name: base } });
    if (!exists) return base;
    return `${base.slice(0, 100 - String(user.id).length - 1)}#${user.id}`;
  }

  /** 首次对话前写入工位令牌文件（agent-token / .env） */
  private async prepareWorkdir(
    worker: Worker,
    executor: Executor,
    workdir: string,
  ): Promise<void> {
    if (this.prepared.has(worker.id)) return;
    // 个人 AGENT 与主人真人机器人共用工作令牌，平台操作身份统一为真人
    const token = await this.workersService.ensureWorkToken(worker.id);
    const client = new OpencodeClient(executor);
    const dir = `${workdir}/.opencode`;
    // 调试/聊天与任务执行共用工位根目录，AGENTS.md 与 .opencode 就是当前目录，
    // 无需再为独立调试目录创建符号链接。
    await withTimeout(
      client.shell(
        `mkdir -p ${shellQuote(dir)} && ` +
          `${agentTokenShell(workdir, token)} && ` +
          `${workerEnvShell(workdir, {
            LITA_WORK_TOKEN: token,
            LITA_PROJECT_TOKEN: token,
          })} && ${workMcpConfigShell(workdir, this.appUrl, token)}`,
      ),
      PREPARE_TIMEOUT_MS,
      '准备个人 AGENT 工位超时',
    );
    this.prepared.add(worker.id);
  }

  /**
   * 后台初始化个人 AGENT 工位：按默认技能库安装 lita-work 技能，
   * 再调用机器人初始化写入 AGENTS.md。失败只告警，不阻断对话。
   */
  private async bootstrapEnvironment(worker: Worker): Promise<void> {
    // 1) 技能清单：成功后不再重复；旧版 project-manage/project-files 自动替换为 lita-work
    const currentSkills = worker.skills ?? [];
    const hasDeprecatedSkill = currentSkills.some((skill) =>
      isDeprecatedPersonalAgentSkill(skill.path),
    );
    if (
      !this.skillsInstalled.has(worker.id) &&
      (!currentSkills.length || hasDeprecatedSkill)
    ) {
      try {
        const catalog = await this.skillCatalog.list();
        const wanted = PERSONAL_AGENT_SKILL_PATHS.map((path) =>
          catalog.find(
            (item) => item.path === path || item.path.endsWith(`/${path}`),
          ),
        ).filter((item): item is NonNullable<typeof item> => Boolean(item));
        if (wanted.length > 0) {
          const kept = currentSkills.filter(
            (skill) => !isDeprecatedPersonalAgentSkill(skill.path),
          );
          const merged = [...kept, ...wanted].filter(
            (skill, index, all) =>
              all.findIndex((item) => item.path === skill.path) === index,
          );
          await this.workers.update({ id: worker.id }, { skills: merged });
          worker.skills = merged;
          this.skillsInstalled.add(worker.id);
        }
      } catch (error) {
        this.logger.warn(
          `个人 AGENT #${worker.id} 技能安装清单获取失败: ${(error as Error).message}`,
        );
      }
    }
    // 2) 工位初始化：写入 AGENTS.md 与技能文件；失败时下次对话重试
    if (this.envStarted.has(worker.id)) return;
    try {
      await this.environment.start(worker.id);
      this.envStarted.add(worker.id);
    } catch (error) {
      this.logger.warn(
        `个人 AGENT #${worker.id} 工位初始化失败: ${(error as Error).message}`,
      );
    }
  }
}

/** Promise 超时包装（避免执行器失联时请求悬挂） */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

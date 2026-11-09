import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter } from 'events';
import { Observable } from 'rxjs';
import { Repository } from 'typeorm';
import {
  WorkerGithubPermission,
  WorkerResourcePermission,
  WorkerRuntime,
} from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeEventHub } from '../executors/opencode-event-hub.service';
import type { OpencodeEvent } from '../executors/opencode-event-hub.service';
import { isFreshOutcome, OpencodeClient } from '../executors/opencode-client';
import { Worker } from './worker.entity';
import {
  agentTokenShell,
  workerEnvShell,
  workMcpConfigShell,
} from './worker-env';
import { WorkersService } from './workers.service';
import { GithubPermissionCredentialService } from './github-permission-credential.service';
import { GithubCredentialStatus } from '../github-gateway/github-permission-credential.entity';
import {
  ManagedStandardFiles,
  WorkerStandardCatalogService,
} from './worker-standard-catalog.service';

/** 初始化任务超时（含技能下载与规范文档同步） */
const INITIALIZE_TIMEOUT_MS = 10 * 60_000;
/** 轮询会话终态的间隔 */
const POLL_MS = 2_000;
/** 终态快照保留时长（晚订阅/刷新页面的客户端可立即拿到结果） */
const JOB_TTL_MS = 5 * 60_000;
/** SSE 心跳间隔（须小于网关空闲超时，如 ALB 60s） */
const STREAM_PING_MS = 15_000;
/** 进度行上限（防失控任务撑爆内存） */
const MAX_LINES = 500;

/** 平台统一注入工位 AGENTS.md 的多机器人协同协议（角色定义之后原样保留）。 */
const TASK_COLLABORATION_AGENTS = `## 多机器人任务协同协议（平台固定）

### 基本原则

1. 一个任务有且只有一个负责机器人和一个需求方；需求方可以是人类用户，也可以是父任务机器人。
2. 任务来源包括人类创建和机器人通过 task-create 创建。你可以并行执行多个「进行中」任务，上限由平台配置（默认 3，1 表示串行）；达到上限时新任务保持等待，等待中的任务不占用执行容量，可以接受其他任务。
3. 机器人身份令牌位于 .opencode/agent-token，同时写入 .opencode/.env 的 LITA_WORK_TOKEN（新名，优先）与 LITA_PROJECT_TOKEN（兼容旧名），两者同值。调用平台所有 .md 接口时先执行 \`set -a; . .opencode/.env; set +a\`，再使用 \`X-Agent-Token: \${LITA_WORK_TOKEN:-$LITA_PROJECT_TOKEN}\`（或 \`TOKEN=$(cat .opencode/agent-token)\` + \`X-Worker-Token: $TOKEN\`）；不得把令牌写入聊天、交付物或文档。

### 工位环境变量（.opencode/.env）

- .opencode/.env 由平台注入并维护（权限 600，不得读取展示、改写或删除）：
  - \`LITA_WORK_TOKEN\`：访问项目平台 .md 接口的机器人独立令牌（新名，优先使用），与 .opencode/agent-token 同值，放在 \`X-Agent-Token\` 或 \`X-Worker-Token\` 均可。
  - \`LITA_PROJECT_TOKEN\`：同一机器人令牌的兼容旧名，仅在旧脚本只认旧名时使用；新调用优先 \`LITA_WORK_TOKEN\`。
  - \`LITA_USER_TOKEN\`：访问 Lita 平台的用户令牌，供 lita-api 等技能使用；执行器宿主 ~/.env 也有同名配置。
- **环境变量优先级（硬性）**：调用 lita-work 等技能前，工位 \`.opencode/.env\` 中的环境变量优先级最高，高于当前进程环境变量和执行器宿主 \`~/.env\`；同名变量必须以 \`.opencode/.env\` 为准，不得用 \`~/.env\` 或进程环境中的同名值覆盖。
- 每次调用相关技能前，必须在同一个 shell 中先执行：\`set -a; . .opencode/.env; set +a\`，再执行技能或接口调用。
- 不得把令牌写入聊天、交付物、文档或代码仓库。

### 平台 MCP 服务（lita-work）

- 工位由平台注入 \`.opencode/opencode.json\`，MCP 服务 \`lita-work\` 指向平台 \`/api/mcp/work\`（Streamable HTTP，机器人令牌鉴权），自动连接，无需手动配置或启动。
- 项目搜索/详情、项目文档、知识库、检查/用例/导出运行、缺陷、提测、代码分支、文件上传等操作优先使用 lita-work 的 MCP 工具。
- 任务协同、工单与机器人管理仍使用下方 \`.md\` 接口（MCP 二期提供）。

### 任务状态与动作

- 待分配 → 待接受：平台按任务定义分配机器人并发送邀约。
- 待接受 → 执行中：确认任务匹配后调用 task-accept。接受失败或提示执行容量已满时不要执行，保持等待。
- 待接受 → 已拒绝：任务不匹配自己的职责时，只能在待接受阶段调用 task-refuse，必须填写拒绝理由 reason，并尽量给出发送建议 suggestion（推荐任务定义或机器人）。不得接受后再拒绝，也不得把不匹配任务转交他人代替拒绝接口。
- 执行中 → 待反馈：需要需求方澄清时调用 task-question-ask，由 project 创建和展示提问；不要使用 opencode 原生 question。调用后停止本轮，等待平台恢复。
- 待反馈 → 待继续 → 执行中：需求方答复后，平台在机器人仍有执行容量时恢复原任务会话。
- 执行中维护交付文档：接受任务并开始处理后，立即调用 task-handoff-update 创建 HANDOFF（首次使用 baseVersion=0）；每完成一个重要阶段、取得关键产物、完成验证或出现阻塞时及时更新，申请验收前补齐最终交付内容。
- 任务文档目录：任务相关文档默认放在 /task/{yyyyMMdd}/{任务编号}/，常用 API.md（接口）、TECH_DESIGN.md（技术方案）、HANDOFF.md（交付）、REVIEW.md（复盘，验收后平台生成）；需求明确指定文档地址时按指定地址写入，不要另起目录。
- 任务目录下的普通文档用 task-documents-list / task-documents-update 读写；HANDOFF 仍用 task-handoff-update，REVIEW 不要自行创建。
- 执行中 → 待申请验收：本轮答复结束且 opencode 会话没有后续排队消息时，平台会释放该任务的执行容量，任务转为「等待中-待申请验收」，你可以继续承接其它任务；平台会重新唤醒你申请验收。
- 待申请验收 → 待验收：完成、自检并准备好交付物后调用 task-handoff-apply；申请前必须确认 HANDOFF 已创建且为最终内容，申请验收只锁定当前交付文档版本，未创建或正文为空会被拒绝。会话结束不等于完成，不调用申请接口任务不会自动进入待验收。
- 待验收 → 完成/待继续或执行中/失败：只能由任务需求方分别调用 task-handoff-accept、task-handoff-refuse 或 task-fail。机器人不得代替需求方验收或判失败。

### 创建与处理子任务

1. 先阅读当前任务定义，判断是否需要其他类型机器人协同；不要无目的拆分。
2. 需要拆分时，先调用 task-defines 查询当前支持分发的任务定义，再调用 task-create 创建子任务，明确输入与输出要求。
3. 你是自己所创建子任务的需求方。子任务提问、申请验收或被拒绝时，平台会把事件持久化到收件箱，并在你仍有执行容量时唤醒父任务会话。
4. 对子任务提问调用 task-question-answer；对交付物调用 task-handoff-accept、task-handoff-refuse 或 task-fail；对被拒绝任务根据拒绝理由和分发建议决定是否重新创建子任务。
5. 处理完子任务事件后继续父任务。不要代替子任务执行机器人调用 task-accept、task-question-ask 或 task-handoff-apply。

### 我的任务与创建根任务

- 任务清单：GET /api/tasks.md?scope=mine（按身份只返回自己作为需求方/执行方的任务）
- 任务详情：GET /api/tasks/{taskId}.md（仅需求方/执行方可读）
- 创建根任务：POST /api/tasks/create.md（body 至少提供 title 或 description；平台自动分配机器人）

### 可用操作

- task-defines：GET /api/tasks/defines.md
- task-create：POST /api/tasks/{parentTaskId}/subtasks/create.md
- task-accept：POST /api/tasks/{taskId}/accept-task.md
- task-refuse：POST /api/tasks/{taskId}/refuse.md
- task-question-ask：POST /api/tasks/{taskId}/questions/ask.md
- task-question-answer：POST /api/tasks/{taskId}/questions/{questionId}/answer.md
- task-documents-list：GET /api/tasks/{taskId}/documents.md
- task-documents-update：POST /api/tasks/{taskId}/documents.md
- ticket-documents-list：GET /api/tasks/{taskId}/ticket-documents.md（所属工单的交付文档清单与调用示例）
- ticket-documents-create：POST /api/tasks/{taskId}/ticket-documents.md（body 提供 title + url 或 content 二选一）
- ticket-documents-update：POST /api/tasks/{taskId}/ticket-documents/{documentId}/update.md
- ticket-documents-delete：POST /api/tasks/{taskId}/ticket-documents/{documentId}/delete.md
- task-handoff-read：GET /api/tasks/{taskId}/handoff.md
- task-handoff-update：POST /api/tasks/{taskId}/handoff/update.md
- task-handoff-apply：POST /api/tasks/{taskId}/handoff/apply.md
- task-handoff-accept：POST /api/tasks/{taskId}/handoff/accept.md
- task-handoff-refuse：POST /api/tasks/{taskId}/handoff/refuse.md
- task-fail：POST /api/tasks/{taskId}/fail.md
`;

/** 初始化状态：idle=无任务（从未初始化或快照已过期清理） */
export type WorkerInitializeStatus = 'idle' | 'running' | 'success' | 'failed';

/** 初始化快照：POST 响应、GET 查询与 SSE snapshot 事件共用（JSON 安全） */
export interface WorkerInitializeSnapshot {
  workerId: number;
  status: WorkerInitializeStatus;
  /** 进度行（时间正序，最新在末尾） */
  lines: string[];
  error: string | null;
  workdir: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/** SSE 载荷：snapshot=全量快照（订阅即推+终态）；line=进度行增量；ping=心跳 */
type InitializeStreamPayload =
  | { type: 'snapshot'; snapshot: WorkerInitializeSnapshot }
  | { type: 'line'; line: string }
  | { type: 'ping' };

/** 一次初始化任务的内存态（不落库：平台重启即丢失，前端会提示重试） */
interface InitializeJob {
  workerId: number;
  status: WorkerInitializeStatus;
  lines: string[];
  error: string | null;
  workdir: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  /** SSE 订阅广播 */
  emitter: EventEmitter;
  /** 终态后的 TTL 清理定时器 */
  ttlTimer?: NodeJS.Timeout;
}

/** 执行器工具名 → 进度行展示文案（未收录的原样展示） */
const TOOL_LABELS: Record<string, string> = {
  read: '读取文件',
  write: '写入文件',
  edit: '编辑文件',
  bash: '执行命令',
  glob: '查找文件',
  grep: '搜索内容',
  webfetch: '访问网页',
  task: '委派子任务',
  todowrite: '更新待办',
  todoread: '读取待办',
};

/**
 * 机器人工作环境初始化：把数据库中的 AGENTS.md、技能引用与规范引用应用到工位。
 * 工位目录结构：
 * - AGENTS.md
 * - .opencode/skills/
 * - .opencode/rules/（选中规范的目录镜像，另有 .standards-manifest.json 受管清单）
 * - .opencode/docs/（机器人自行维护的知识文档）
 *
 * 执行模型：POST 启动后台任务并立即返回运行快照，进度经 SSE 实时推送。
 * 同步长请求会被网关（ALB 60s）以 504 掐断而后端继续跑完，故刻意异步化。
 */
@Injectable()
export class WorkerEnvironmentService implements OnModuleDestroy {
  private readonly logger = new Logger(WorkerEnvironmentService.name);
  /** workerId → 最近一次初始化任务（终态保留 JOB_TTL_MS 供晚订阅查询） */
  private readonly jobs = new Map<number, InitializeJob>();

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
    private readonly standardCatalog: WorkerStandardCatalogService,
    private readonly eventHub: OpencodeEventHub,
    private readonly config: ConfigService,
    @Optional()
    private readonly githubCredentials?: GithubPermissionCredentialService,
  ) {}

  /**
   * 启动初始化任务：同步完成全部前置校验（配置类错误立即 400），
   * 随后后台执行并立即返回运行快照；同一机器人进行中时幂等返回现有快照。
   */
  async start(id: number): Promise<WorkerInitializeSnapshot> {
    const worker = await this.workers.findOne({ where: { id } });
    if (!worker) throw new BadRequestException('机器人不存在');
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('仅支持 opencode 机器人初始化');
    }
    if (
      !worker.executorId ||
      !worker.providerId?.trim() ||
      !worker.modelId?.trim()
    ) {
      throw new BadRequestException(
        '初始化工作环境前，请先配置执行器、供应商与模型',
      );
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) {
      throw new BadRequestException('未配置 WORKER_BASE_DIR，无法确定工位目录');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor || !executor.online) {
      throw new BadRequestException(
        `执行器 #${worker.executorId} 离线或不存在，无法初始化工作环境`,
      );
    }

    const running = this.jobs.get(id);
    if (running && running.status === 'running') {
      return this.toSnapshot(running);
    }
    // 覆盖终态旧任务：先清其 TTL 定时器，避免误清新任务
    if (running?.ttlTimer) clearTimeout(running.ttlTimer);
    const job: InitializeJob = {
      workerId: id,
      status: 'running',
      lines: [],
      error: null,
      workdir: null,
      startedAt: new Date(),
      finishedAt: null,
      emitter: new EventEmitter(),
    };
    // 编辑页/详情页可能同时订阅同一任务的进度
    job.emitter.setMaxListeners(50);
    this.jobs.set(id, job);
    // 刻意不 await：HTTP 请求立刻返回，任务在后台跑完（10 分钟预算）
    void this.run(job, worker, executor, workdir);
    return this.toSnapshot(job);
  }

  /** 最近一次初始化快照（无任务返回 idle） */
  snapshotOf(id: number): WorkerInitializeSnapshot {
    const job = this.jobs.get(id);
    if (job) return this.toSnapshot(job);
    return {
      workerId: id,
      status: 'idle',
      lines: [],
      error: null,
      workdir: null,
      startedAt: null,
      finishedAt: null,
    };
  }

  /**
   * 初始化进度 SSE：订阅即推当前快照，进度行增量推送，终态快照推送后完成流，
   * 心跳保活（小于 ALB 等网关的空闲超时）。
   */
  stream(id: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      const job = this.jobs.get(id);
      if (!job) {
        // 无任务（从未初始化/服务重启后丢失）：推 idle 快照后结束，前端据此提示重试
        subscriber.next({
          data: {
            type: 'snapshot',
            snapshot: this.snapshotOf(id),
          } satisfies InitializeStreamPayload,
        });
        subscriber.complete();
        return;
      }
      let closed = false;
      const finishStream = () => {
        closed = true;
        clearInterval(keepalive);
        subscriber.complete();
      };
      const listener = (payload: InitializeStreamPayload) => {
        if (closed) return;
        subscriber.next({ data: payload });
        if (
          payload.type === 'snapshot' &&
          (payload.snapshot.status === 'success' ||
            payload.snapshot.status === 'failed')
        ) {
          finishStream();
        }
      };
      // 心跳先建（须小于网关空闲超时），保证任何触发路径都能安全清理
      const keepalive = setInterval(() => {
        if (!closed) {
          subscriber.next({
            data: { type: 'ping' } satisfies InitializeStreamPayload,
          });
        }
      }, STREAM_PING_MS);
      // 先挂监听再推快照，避免间隙漏事件
      job.emitter.on('payload', listener);
      listener({ type: 'snapshot', snapshot: this.toSnapshot(job) });
      return () => {
        closed = true;
        clearInterval(keepalive);
        job.emitter.off('payload', listener);
      };
    });
  }

  /** 后台执行：建工位 → 建会话 → 下发初始化指令 → 轮询终态 → 校验 DONE */
  private async run(
    job: InitializeJob,
    worker: Worker,
    executor: Executor,
    workdir: string,
  ): Promise<void> {
    const client = new OpencodeClient(executor);
    // 执行期间占用执行器事件流，结束后释放（引用归零延迟断开）
    this.eventHub.retain(executor);
    try {
      this.pushLine(job, `▶ 开始初始化工位 ${workdir}`);
      // 幂等建立工位骨架，初始化会话内仍会按需补齐
      this.pushLine(job, '· 创建工位目录…');
      await client.shell(
        `mkdir -p '${workdir}' '${workdir}/.opencode/skills' '${workdir}/.opencode/rules' '${workdir}/.opencode/docs'`,
      );
      this.pushLine(job, '· 写入机器人身份令牌（agent-token / .env）…');
      await this.writeAgentToken(client, worker.id, workdir);
      this.pushLine(job, '· 注入 lita-work MCP 配置…');
      await this.writeWorkMcpConfig(client, worker.id, workdir);
      this.pushLine(job, '· 注入 Lita 用户令牌…');
      await this.writeLitaUserToken(client, workdir);
      const githubCredentialStatus = (await this.githubCredentials?.statusOf(
        worker.githubPermission,
      )) ?? {
        configured: false,
        enabled: false,
        githubAccount: null,
        rotatedAt: null,
      };
      this.pushLine(
        job,
        `· GitHub 权限：${this.githubPermissionLabel(worker.githubPermission)}；凭证：${
          githubCredentialStatus.configured
            ? githubCredentialStatus.enabled
              ? '已配置'
              : '已停用'
            : '未配置'
        }`,
      );
      this.pushLine(job, '· 生成初始化指令（AGENTS.md + 技能 + 规范）…');
      const prompt = await this.buildPrompt(worker, githubCredentialStatus);
      this.pushLine(
        job,
        `· 创建执行器会话（${worker.providerId}/${worker.modelId}）…`,
      );
      const session = await client.createSession({
        title: `初始化机器人 #${worker.id} ${worker.name}`.slice(0, 100),
        // 空值已在 start() 校验过（缺失即 400），此处断言非空
        model: {
          id: worker.modelId!,
          providerID: worker.providerId!,
          ...(worker.variant ? { variant: worker.variant } : {}),
        },
        location: { directory: workdir },
      });
      // 订阅执行器事件：把该会话的工具调用转成进度行（先订阅再下发，避免漏事件）
      const unsubscribe = this.eventHub.onEvent((event) =>
        this.onExecutorEvent(job, session.id, event),
      );
      let text: string | null = null;
      try {
        this.pushLine(job, '· 下发初始化任务…');
        // prompt 为异步接口；outcome 具有粘性，以本轮用户消息时间为新鲜度基准
        const promptResult = await client.prompt(session.id, {
          text: prompt,
        });
        const afterMs = promptResult?.time?.created ?? 0;
        const deadline = Date.now() + INITIALIZE_TIMEOUT_MS;
        while (Date.now() < deadline) {
          const info = await client.session(session.id);
          if (isFreshOutcome(info, afterMs)) {
            if (info.outcome !== 'succeeded') {
              throw new Error(`执行器会话 ${session.id} 执行失败`);
            }
            // 会话终态与消息落库可能有短暂延迟，重试几次再取文本
            for (let attempt = 0; attempt < 3 && !text; attempt++) {
              text = await client.lastAssistantText(session.id, afterMs);
              if (!text && attempt < 2) await sleep(500);
            }
            if (!text?.trim()) {
              throw new Error('执行器会话已结束但没有文本输出');
            }
            break;
          }
          await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
        }
      } finally {
        unsubscribe();
      }
      if (!text?.trim()) {
        await client.interrupt(session.id).catch(() => undefined);
        throw new Error(
          `执行器会话执行超时（超过 ${Math.round(INITIALIZE_TIMEOUT_MS / 60_000)} 分钟）`,
        );
      }
      this.pushLine(job, '· 校验初始化结果…');
      this.assertDone(text);
      this.finish(job, 'success', null, workdir);
    } catch (e) {
      this.finish(job, 'failed', (e as Error).message);
    } finally {
      this.eventHub.release(executor.id);
    }
  }

  /**
   * 把机器人工作令牌写入工位 .opencode/agent-token，并同步到 .opencode/.env 的
   * LITA_WORK_TOKEN（新名，优先）与 LITA_PROJECT_TOKEN（兼容旧名）。
   * 个人 AGENT 使用其主人真人机器人的令牌。
   * 令牌只经服务端落盘，不进入初始化 Prompt、SSE 进度或日志。
   */
  private async writeAgentToken(
    client: OpencodeClient,
    workerId: number,
    workdir: string,
  ): Promise<void> {
    const token = await this.workersService.ensureWorkToken(workerId);
    await client.shell(
      `${agentTokenShell(workdir, token)} && ` +
        workerEnvShell(workdir, {
          LITA_WORK_TOKEN: token,
          LITA_PROJECT_TOKEN: token,
        }),
    );
  }

  /**
   * 注入 lita-work MCP 服务配置（.opencode/opencode.json，权限 600）：
   * opencode 按项目配置自动连接平台 /api/mcp/work，替代技能内的 curl 调用。
   * 令牌只经服务端落盘，不进入 Prompt、SSE 进度或日志。
   */
  private async writeWorkMcpConfig(
    client: OpencodeClient,
    workerId: number,
    workdir: string,
  ): Promise<void> {
    const token = await this.workersService.ensureWorkToken(workerId);
    const appUrl = (
      this.config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/+$/, '');
    await client.shell(workMcpConfigShell(workdir, appUrl, token));
  }

  /**
   * 把 Lita 用户令牌写入工位 .opencode/.env 的 LITA_USER_TOKEN（权限 600，保留其他键），
   * 供 lita-api 等技能使用；同时同步到执行器宿主 ~/.env（保留其他变量），
   * 兼容按 ~/.env 读取令牌的技能。
   * 优先 WORKER_LITA_USER_TOKEN，未配置时回退平台自身的 LITA_USER_TOKEN。
   * 令牌只经服务端落盘，不进入初始化 Prompt、SSE 进度或日志。
   */
  private async writeLitaUserToken(
    client: OpencodeClient,
    workdir: string,
  ): Promise<void> {
    const token =
      this.config.get<string>('WORKER_LITA_USER_TOKEN')?.trim() ||
      this.config.get<string>('LITA_USER_TOKEN')?.trim();
    if (!token) {
      this.logger.warn(
        '未配置 WORKER_LITA_USER_TOKEN/LITA_USER_TOKEN，跳过工位 Lita 用户令牌注入',
      );
      return;
    }
    await client.shell(workerEnvShell(workdir, { LITA_USER_TOKEN: token }));
    // 兼容按 ~/.env 读取令牌的技能（如 lita-api）：同步到执行器宿主，保留其他变量
    try {
      await client.shell(
        `if [ -n "$HOME" ]; then { grep -v '^LITA_USER_TOKEN=' "$HOME/.env" 2>/dev/null; ` +
          `printf '%s\\n' 'LITA_USER_TOKEN=${token}'; } > "$HOME/.env.tmp" && ` +
          `chmod 600 "$HOME/.env.tmp" && mv "$HOME/.env.tmp" "$HOME/.env"; fi`,
      );
    } catch (e) {
      this.logger.warn(
        `同步 Lita 用户令牌到执行器 ~/.env 失败：${(e as Error).message}`,
      );
    }
  }

  /** 执行器事件 → 进度行：仅取初始化会话的工具调用（与任务详情的终端行同风格） */
  private onExecutorEvent(
    job: InitializeJob,
    sessionId: string,
    event: OpencodeEvent,
  ): void {
    if (job.status !== 'running') return;
    const data = event.data as { sessionID?: string; name?: string } | null;
    if (!data || data.sessionID !== sessionId) return;
    if (event.type === 'session.execution.started') {
      this.pushLine(job, '▶ 执行器开始执行');
      return;
    }
    if (event.type === 'session.tool.input.started') {
      const name = data.name || '?';
      this.pushLine(job, `🔧 ${TOOL_LABELS[name] ?? name}`);
    }
  }

  /** 追加进度行并广播（超上限丢弃最旧行） */
  private pushLine(job: InitializeJob, line: string): void {
    job.lines.push(line);
    if (job.lines.length > MAX_LINES) {
      job.lines.splice(0, job.lines.length - MAX_LINES);
    }
    job.emitter.emit('payload', {
      type: 'line',
      line,
    } satisfies InitializeStreamPayload);
  }

  /** 终态落快照、广播、保留 TTL 后清理 */
  private finish(
    job: InitializeJob,
    status: 'success' | 'failed',
    error: string | null,
    workdir?: string,
  ): void {
    if (job.status !== 'running') return;
    job.status = status;
    job.error = error;
    job.workdir = workdir ?? null;
    job.finishedAt = new Date();
    if (status === 'success') {
      this.pushLine(job, `✅ 工作环境初始化完成：${workdir}`);
      this.logger.log(`机器人 #${job.workerId} 工作环境已初始化：${workdir}`);
    } else {
      this.pushLine(job, `✗ 初始化失败：${error ?? '未知错误'}`);
      this.logger.warn(
        `机器人 #${job.workerId} 工作环境初始化失败：${error ?? '未知错误'}`,
      );
    }
    job.emitter.emit('payload', {
      type: 'snapshot',
      snapshot: this.toSnapshot(job),
    } satisfies InitializeStreamPayload);
    const timer = setTimeout(() => {
      // 仅清理自己：TTL 期间同机器人可能已启动新任务
      if (this.jobs.get(job.workerId) === job) this.jobs.delete(job.workerId);
    }, JOB_TTL_MS);
    timer.unref();
    job.ttlTimer = timer;
  }

  private toSnapshot(job: InitializeJob): WorkerInitializeSnapshot {
    return {
      workerId: job.workerId,
      status: job.status,
      lines: [...job.lines],
      error: job.error,
      workdir: job.workdir,
      startedAt: job.startedAt.toISOString(),
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }

  onModuleDestroy(): void {
    for (const job of this.jobs.values()) {
      if (job.ttlTimer) clearTimeout(job.ttlTimer);
    }
    this.jobs.clear();
  }

  /** 初始化任务指令：AGENTS.md 原文 + 技能库链接 + 规范目录同步要求 + 工位结构约定 */
  private async buildPrompt(
    worker: Worker,
    githubCredentialStatus: GithubCredentialStatus = {
      configured: false,
      enabled: false,
      githubAccount: null,
      rotatedAt: null,
    },
  ): Promise<string> {
    const agents = worker.prompt ?? '';
    const skills = worker.skills ?? [];
    const standards = await this.resolveStandardFiles(worker.standards);
    const skillLines = skills.length
      ? skills
          .map(
            (skill) =>
              `- [${skill.name}](${skill.url})（目录：${skill.path.slice(
                0,
                -'/SKILL.md'.length,
              )}${skill.version ? `，版本：${skill.version}` : ''}）`,
          )
          .join('\n')
      : '（本次清单为空：不保留任何技能目录）';
    const standardsByDirectory = new Map(
      (worker.standards ?? []).map((item) => [item.directory, item]),
    );
    // 文件按最具体的选中目录分组，避免嵌套选择时重复列出
    const ruleFiles = new Map<string, string[]>(
      standards.directories.map((directory) => [directory, []]),
    );
    for (const file of standards.files) {
      const owner = standards.directories
        .filter(
          (directory) => file === directory || file.startsWith(`${directory}/`),
        )
        .sort((a, b) => b.length - a.length)[0];
      if (owner) ruleFiles.get(owner)?.push(file);
    }
    const standardLines = standards.directories.length
      ? standards.directories
          .map((directory) => {
            const standard = standardsByDirectory.get(directory);
            const sourceUrl = standard?.sourceUrl || standard?.url || directory;
            const description = standard?.description?.trim();
            return `- [${standard?.name || directory}](${sourceUrl})（源目录：${directory}；工位目录：.opencode/rules/${directory}${
              standard?.version ? `；版本：${standard.version}` : ''
            }${description ? `；说明：${description}` : ''}）`;
          })
          .join('\n')
      : '（本次规范清单为空：只移除 .opencode/rules/.standards-manifest.json 中记录的旧规范文件，不处理其他文档）';
    const requiredFileLines = standards.files.length
      ? standards.files
          .map(
            (path) =>
              `- [${path}](${standards.rawBase}/${path
                .split('/')
                .map(encodeURIComponent)
                .join('/')})`,
          )
          .join('\n')
      : '（无）';
    // 写入 AGENTS.md 的规范清单：名称、说明、工位目录与全部规则文档
    const rulesSection = standards.directories.length
      ? [
          '## 规范与规则',
          '',
          '以下规范由平台同步到 `.opencode/rules/`，执行任务前按需阅读对应文档。',
          '',
          ...standards.directories.flatMap((directory) => {
            const standard = standardsByDirectory.get(directory);
            const name = standard?.name || directory;
            const description =
              standard?.description?.trim() || '（未提供说明）';
            const version = standard?.version?.trim();
            const sourceUrl = standard?.sourceUrl || standard?.url;
            const files = (ruleFiles.get(directory) ?? []).map((file) =>
              file === directory
                ? (file.split('/').pop() ?? file)
                : file.slice(directory.length + 1),
            );
            return [
              `### ${name}`,
              '',
              `- 说明：${description}`,
              ...(version ? [`- 版本：${version}`] : []),
              ...(sourceUrl ? [`- 原文：${sourceUrl}`] : []),
              `- 工位目录：\`.opencode/rules/${directory}\``,
              '- 文档：',
              ...files.map((file) => `  - \`${file}\``),
              '',
            ];
          }),
        ].join('\n')
      : '## 规范与规则\n\n本次未选择规范。';

    const githubSection = this.buildGithubAgentsSection(
      worker,
      githubCredentialStatus,
    );
    const resourceSection = this.buildResourceAgentsSection(worker);

    return `接下来，更新当前的工作环境：

## 根据以下信息更新AGENTS.md 以下为AGENTS.md 内容

### 工作职责定义
\`\`\`\`markdown
${agents}
\`\`\`\`

### 平台固定协同协议
\`\`\`\`markdown
${TASK_COLLABORATION_AGENTS}
\`\`\`\`

### GitHub 操作权限（必须写入 AGENTS.md）

把以下内容原样写入 AGENTS.md 的「## GitHub 操作权限」小节，权限、允许/禁止事项与凭证状态不得删减或改写：

\`\`\`\`markdown
${githubSection}
\`\`\`\`

### 资源访问权限（必须写入 AGENTS.md）

把以下内容原样写入 AGENTS.md 的「## 资源访问权限」小节，权限与允许/禁止事项不得删减或改写：

\`\`\`\`markdown
${resourceSection}
\`\`\`\`

### 规范与规则（必须写入 AGENTS.md）

把以下内容原样写入 AGENTS.md 的「## 规范与规则」小节，规范名称、说明、工位目录与文档清单不得删减：

\`\`\`\`markdown
${rulesSection}
\`\`\`\`

### 目录结构

- AGENTS.md    机器人的工作基本原则
- .opencode/   opencode自身的目录
- .opencode/agent-token   平台注入的机器人身份令牌（权限 600，不得读取展示、改写或删除）
- .opencode/.env   平台注入的工位环境变量（权限 600，不得读取展示、改写或删除）：LITA_WORK_TOKEN 访问项目平台 .md 接口（新名，优先，与 agent-token 同值）、LITA_PROJECT_TOKEN 兼容旧名（同值）、LITA_USER_TOKEN 访问 Lita 平台技能
- .opencode/opencode.json   平台注入的 lita-work MCP 配置（权限 600，不得读取展示、改写或删除）
- .opencode/skills/   当前机器人的技能
- .opencode/rules/   平台同步的规范与规则文档（保持规范库原始目录结构；.standards-manifest.json 是受管清单）
- .opencode/rules/.standards-manifest.json   本次同步的规范文件清单（JSON：{"version":1,"files":[...]}）
- .opencode/docs/     机器人自行维护的知识文档（opencode 可以根据完成任务的情况更新总结）

### 更新要求

1. 把「工作职责定义」和「平台固定协同协议」中的 Markdown 原文完整写入当前工作目录的 AGENTS.md；不要改写、缩写或额外发挥。协同协议放在工作职责定义之后。
2. 把「GitHub 操作权限（必须写入 AGENTS.md）」中的 Markdown 原样写入 AGENTS.md 的「## GitHub 操作权限」小节；权限、允许/禁止事项与凭证状态不得删减。
3. 把「资源访问权限（必须写入 AGENTS.md）」中的 Markdown 原样写入 AGENTS.md 的「## 资源访问权限」小节；权限与允许/禁止事项不得删减。
4. 把「规范与规则（必须写入 AGENTS.md）」中的 Markdown 原样写入 AGENTS.md 的「## 规范与规则」小节；规范名称、说明、工位目录与文档清单不得删减。
5. 确保 AGENTS.md 中包含上面的目录结构说明。
6. 保留 .opencode/ 下与本次更新无关的配置，尤其不得读取展示、改写或删除 .opencode/agent-token 与 .opencode/.env；不得清空或改写 .opencode/docs/ 中机器人自行维护的文档。
7. .opencode/skills/ 以本次技能清单为准：安装或更新清单中的全部技能；移除清单之外的旧技能目录。
8. 安装技能时不要只保存 SKILL.md：按技能目录保持原始结构，并下载技能引用到的脚本、模板等资源文件。
9. .opencode/rules/ 中的规范文档以本次规范清单为准：
   - 如果 .opencode/rules/.standards-manifest.json 存在，先读取其中 files 数组作为旧受管文件清单；不存在或内容非法时旧受管清单视为空。
   - 如果旧的 .opencode/docs/.standards-manifest.json 存在：先按其 files 清单删除 .opencode/docs/ 下对应的旧受管文件，再删除该旧清单；这是目录从 docs 迁移到 rules 的一次性清理，其他 docs 文档不要动。
   - 按下方「需存在的规范文件」下载并写入 .opencode/rules/ 下同名相对路径；保持文件内容与链接内容一致，不要改写或摘要。
   - 只删除「旧受管文件清单中存在、但本次需存在清单中没有」的文件；不要删除 .opencode/docs/ 或其他流程产生的文档。
   - 同步完成后把本次需存在的全部相对路径写入 .opencode/rules/.standards-manifest.json，格式为 {"version":1,"files":[...]}，路径按字典序排序；manifest 自身不要写入 files。
10. 需要创建目录时保持仓库原始目录结构；同名文件以本次规范库内容覆盖。
11. .opencode/opencode.json 由平台注入并维护（lita-work MCP 配置），不得读取展示、改写或删除。

## 从以下链接中，安装或更新技能

${skillLines}

## 规范目录

${standardLines}

## 需存在的规范文件（左侧为相对 .opencode/rules/ 的路径，右侧为原始文件地址）

${requiredFileLines}

---

### 返回协议

1. 执行过程中的检查、下载和说明不要写入最终回复。
2. 任务成功时，最终回复的正文必须只有一行：DONE；不要附带验证报告，也不要包在代码块里。
3. 任务失败时，最终回复的正文必须只有一行：ERROR: 具体原因。
`;
  }

  /**
   * 生成写入工位 AGENTS.md 的 GitHub 权限说明。
   * 只描述权限、允许/禁止事项与凭证可用性；不得出现 PAT、密文或 SecretRef。
   */
  private buildGithubAgentsSection(
    worker: Worker,
    status: GithubCredentialStatus,
  ): string {
    const permission = worker.githubPermission;
    const credentialText = !status.configured
      ? '未配置'
      : status.enabled
        ? `已配置${status.githubAccount ? `（GitHub 账号：${status.githubAccount}）` : ''}`
        : `已停用${status.githubAccount ? `（GitHub 账号：${status.githubAccount}）` : ''}`;

    if (permission === WorkerGithubPermission.NONE) {
      return `## GitHub 操作权限

当前权限：无权限。
凭证状态：${credentialText}。

禁止事项：
- 不要调用 OP Gateway 获取 GitHub 凭证。
- 不要 clone、fetch、pull 平台私有仓库，也不要 push 或创建 PR。
- 不要尝试审批或合并 PR。

如果当前任务确实需要 GitHub 操作，应向需求方说明：机器人尚未配置 GitHub 权限，需管理员在机器人配置页调整权限。`;
    }

    if (permission === WorkerGithubPermission.RELEASE) {
      return `## GitHub 操作权限

当前权限：发布权限。
凭证状态：${credentialText}。

允许事项：
- 通过 OP Gateway clone、fetch、pull 仓库。
- 创建任务分支、开发并提交代码。
- push 普通分支。
- 创建目标为 main、stable 的 PR。
- 在确认符合当前任务要求后，直接 push main、stable。
- 在确认符合当前任务要求后，审批 PR、合并 PR。

禁止事项：
- 修改仓库权限、Secret、Ruleset 或删除仓库。
- 试图读取、展示、导出或绕过 OP Gateway 获取 GitHub PAT。
- 执行与当前任务无关的写操作。`;
    }

    return `## GitHub 操作权限

当前权限：开发权限。
凭证状态：${credentialText}。

允许事项：
- 通过 OP Gateway clone、fetch、pull 仓库。
- 创建任务分支、开发并提交代码。
- push 普通分支。
- 创建目标为 main、stable 的 PR。

禁止事项：
- 直接 push main、stable。
- 审批或合并 PR。
- 修改仓库权限、Secret、Ruleset 或删除仓库。
- 试图读取、展示、导出或绕过 OP Gateway 获取 GitHub PAT。`;
  }

  /**
   * 生成写入工位 AGENTS.md 的资源网关权限说明。
   * 只描述权限与允许/禁止事项；不得出现资源密码、Token 或连接串。
   */
  private buildResourceAgentsSection(worker: Worker): string {
    const permission =
      worker.resourcePermission ?? WorkerResourcePermission.NONE;
    if (permission === WorkerResourcePermission.NONE) {
      return `## 资源访问权限

当前权限：无权限。

禁止事项：
- 不要调用 AI Gateway 的资源列表或 SQL 执行接口。
- 不要尝试通过管理接口修改资源配置或申请更高权限。
- 不要获取、展示或推断数据库密码。

如果当前任务确实需要访问内部资源，应向需求方说明：机器人尚未配置资源权限，需管理员在机器人配置页授权。`;
    }
    if (permission === WorkerResourcePermission.READ) {
      return `## 资源访问权限

当前权限：只读资源。

允许事项：
- 通过 AI Gateway 查询可访问的只读资源。
- 对 readOnly=true 的 MySQL 资源执行单条只读 SQL。
- 使用 .opencode/skills 中已安装的 resource-gateway 技能调用资源接口。

禁止事项：
- 不要访问或尝试执行 readOnly=false 的可写资源；网关会返回 403。
- 不要执行 INSERT、UPDATE、DELETE、DDL 等写操作。
- 不要通过管理接口修改资源只读标记或权限。
- 不要获取、展示或写入数据库密码、Token 或连接串。`;
    }
    return `## 资源访问权限

当前权限：全部资源。

允许事项：
- 通过 AI Gateway 查询并访问全部已登记资源。
- 对 MySQL 资源执行任务所需的单条 SQL。
- 使用 .opencode/skills 中已安装的 resource-gateway 技能调用资源接口。

禁止事项：
- readOnly=true 的资源仍执行只读事务；不要尝试绕过该限制。
- 未获得用户明确确认时，不要在生产环境执行写操作。
- 不要通过管理接口修改资源配置或权限。
- 不要获取、展示或写入数据库密码、Token 或连接串。`;
  }

  private githubPermissionLabel(
    permission: Worker['githubPermission'],
  ): string {
    if (permission === WorkerGithubPermission.RELEASE) return '发布权限';
    if (permission === WorkerGithubPermission.NONE) return '无权限';
    return '开发权限';
  }

  /** 解析本次需同步的规范目录与文件清单；规范库不可访问时初始化直接失败 */ private async resolveStandardFiles(
    standards: Worker['standards'],
  ): Promise<ManagedStandardFiles> {
    try {
      return await this.standardCatalog.resolveManagedFiles(standards);
    } catch (e) {
      throw new BadRequestException(`规范库读取失败：${(e as Error).message}`);
    }
  }

  /**
   * 校验初始化协议输出。
   * 优先接受整段 `DONE`；同时兜底接受独立成行的 DONE（部分模型会先输出验证报告，
   * 再把 DONE 放进代码块）。ERROR 优先于 DONE 判定，避免失败报告被误判成功。
   */
  private assertDone(text: string): void {
    const output = text.trim();
    const error = output.match(/(?:^|\n)\s*(?:`{3,}\s*)?ERROR:\s*([\s\S]+)$/);
    if (error) {
      throw new BadRequestException(
        `工作环境初始化失败：${error[1].replace(/`+$/, '').trim() || '未知错误'}`,
      );
    }
    if (this.hasStandaloneDone(output)) return;
    const summary = this.stripFence(output).replace(/\s+/g, ' ').slice(0, 200);
    throw new BadRequestException(
      summary
        ? `工作环境初始化未返回 DONE：${summary}`
        : '工作环境初始化未返回 DONE',
    );
  }

  /** 判断输出中是否有独立成行的 DONE（允许被代码围栏包裹） */
  private hasStandaloneDone(output: string): boolean {
    if (output === 'DONE') return true;
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes('DONE');
  }

  /** 去掉模型偶尔包裹的代码围栏（与 WorkerAiService 相同的兜底） */
  private stripFence(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
    return (fenced ? fenced[1] : trimmed).trim();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

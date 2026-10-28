import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskStatus, TaskSubStatus } from '../common/enums';
import { beijingTime } from '../common/frontmatter';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { encodeKnowledgePath } from '../knowledge/knowledge.path';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { Task } from './task.entity';
import { TaskEvent } from './task-event.entity';
import { TaskMessage } from './task-message.entity';
import { TaskChatService } from './task-chat.service';

/** 机器人总结超时（报告生成涉及完整上下文整理，比普通识别留更长余量） */
const HANDOFF_TIMEOUT_MS = 10 * 60_000;

/** 当前任务自身的事件/对话上下文上限，避免超长任务撑爆模型上下文 */
const MAX_EVENTS = 120;
const MAX_MESSAGES = 60;
const MAX_EVENT_CHARS = 800;
const MAX_MESSAGE_CHARS = 3000;
const MAX_RESULT_CHARS = 20_000;
const MAX_SUMMARY_CHARS = 120_000;
const MAX_PATH_CONFLICT_RETRIES = 20;

/** 机器人总结只负责主观复盘，输入/统计/交付原文由平台确定性拼装 */
const HANDOFF_PROMPT = `你是刚刚完成该任务的机器人。现在任务已通过验收，请基于任务事实和本次对话记录，做一次诚实、精炼的自我总结，用于交接给后续同事或机器人。

要求：
1. 只依据下方事实与对话，不得编造未发生的步骤、弯路、结果或经验；信息不足时直接说明“记录中未体现”。
2. 严格输出以下三个二级标题，顺序固定，且只输出这三节：
## 交付物与结论
说明最终交付了什么、是否达到输出要求、有哪些限制或遗留问题。
## 任务记录与过程复盘
按时间概括关键步骤，重点说明中间走了哪些弯路（如重新识别、返工、中断、失败、等待用户补充、重复执行）。确实没有明确弯路时，写“未发现明确弯路”。
## 经验总结
提炼可复用的经验、检查清单或下次改进项，不要重复上一节的过程叙述，也不要写空泛口号。
3. 不要输出一级标题、前言、后记、代码围栏或与任务无关的客套话。
4. 不要调用任何工具，直接输出 Markdown 正文。`;

export interface TaskHandoffStats {
  /** 用户提交机器人问答卡片的次数（跳过不计） */
  confirmations: number;
  /** 用户补充/反馈消息次数（不含任务创建时的原始需求） */
  supplements: number;
  durationMs: number;
}

export interface TaskHandoffResult {
  version: number;
  path: string;
  title: string;
  url: string;
  content: string;
}

interface HandoffEndpoint {
  worker: Worker | null;
  executor: Executor;
  providerId: string;
  modelId: string;
  workdir: string | null;
}

interface HandoffSections {
  delivery: string;
  process: string;
  lessons: string;
}

function beijingDateStamp(value: Date): string {
  return beijingTime(value).slice(0, 10).replace(/-/g, '');
}

function clip(value: string | null | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n…（内容过长，已截断 ${text.length - limit} 字）`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} 天`);
  if (hours) parts.push(`${hours} 小时`);
  if (minutes) parts.push(`${minutes} 分钟`);
  if (!days && !hours && !minutes) parts.push(`${seconds} 秒`);
  return parts.join(' ');
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

/** 从机器人输出中提取固定三节；缺失的小节给出明确占位而不是编造 */
export function splitHandoffSummary(raw: string): HandoffSections {
  const text = stripFence(raw);
  const heading = /^#{2,4}\s*(交付物与结论|任务记录与过程复盘|经验总结)\s*$/gm;
  const matches = [...text.matchAll(heading)];
  const sections: Record<string, string> = {};
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const start = (match.index ?? 0) + match[0].length;
    const end =
      index + 1 < matches.length
        ? (matches[index + 1].index ?? text.length)
        : text.length;
    sections[match[1]] = text.slice(start, end).trim();
  }
  const fallback = text || '（机器人未输出总结内容）';
  return {
    delivery: sections['交付物与结论'] || fallback,
    process:
      sections['任务记录与过程复盘'] ||
      '（机器人未按约定结构单独输出过程复盘，原始总结见“交付物与结论”）',
    lessons:
      sections['经验总结'] ||
      '（机器人未按约定结构单独输出经验总结，原始总结见“交付物与结论”）',
  };
}

function eventMetaSummary(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  const picked: Record<string, unknown> = {};
  for (const key of ['feedback', 'answers', 'workPlan', 'interrupted']) {
    if (meta[key] !== undefined) picked[key] = meta[key];
  }
  if (Object.keys(picked).length === 0) return '';
  return `\n  附加信息：${clip(JSON.stringify(picked), 800)}`;
}

@Injectable()
export class TaskHandoffService {
  private readonly logger = new Logger(TaskHandoffService.name);

  /** 进程内按任务加锁，防止连续验收/重新生成产生重复报告 */
  private readonly generating = new Set<number>();

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(TaskEvent)
    private readonly events: Repository<TaskEvent>,
    @InjectRepository(TaskMessage)
    private readonly messages: Repository<TaskMessage>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
    private readonly knowledge: KnowledgeService,
    private readonly taskChat: TaskChatService,
  ) {}

  /**
   * 发起任务总结：验收/重新生成共用入口。
   * 只负责校验与排队，实际总结在后台执行，不阻塞验收请求。
   */
  async request(taskId: number): Promise<{ accepted: true; version: number }> {
    const task = await this.mustFind(taskId);
    this.assertCompleted(task);
    if (this.generating.has(taskId)) {
      throw new BadRequestException('任务总结正在生成，请稍候');
    }
    const version = task.handoffCount ?? 0;
    this.generating.add(taskId);
    void this.generateNow(taskId)
      .catch(async (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `任务 ${task.code} 总结报告生成失败（v${version}）：${message}`,
        );
        await this.taskChat
          .postAssistantMessage(
            taskId,
            `任务总结报告生成失败：${message}\n\n任务验收结果不受影响；可点击「重新生成总结」重试。`,
            {
              messageId: this.handoffMessageId(taskId, version),
              status: 'error',
              meta: { handoff: { status: 'error', version } },
            },
          )
          .catch((notifyError: Error) => {
            this.logger.warn(
              `任务 ${task.code} 总结失败消息写入聊天失败：${notifyError.message}`,
            );
          });
      })
      .finally(() => this.generating.delete(taskId));
    return { accepted: true, version };
  }

  /** 生成一份新的总结报告并归档。调用方负责用 request() 做任务级互斥。 */
  async generateNow(taskId: number): Promise<TaskHandoffResult> {
    const task = await this.mustFind(taskId);
    this.assertCompleted(task);
    if (!this.knowledge.isEnabled) {
      throw new BadRequestException(
        this.knowledge.disabledMessage || '知识库不可用，无法归档任务总结',
      );
    }
    const [events, messages] = await Promise.all([
      this.events.find({
        where: { taskId },
        order: { id: 'ASC' },
      }),
      this.messages.find({
        where: { taskId },
        order: { id: 'ASC' },
      }),
    ]);
    const version = task.handoffCount ?? 0;
    const messageId = this.handoffMessageId(taskId, version);
    await this.taskChat.postAssistantMessage(
      taskId,
      `正在生成任务总结报告（v${version}）…`,
      {
        messageId,
        status: 'running',
        meta: { handoff: { status: 'running', version } },
      },
    );

    const endpoint = await this.resolveEndpoint(task);
    const stats = this.statsOf(task, events);
    const raw = await runOpencodePrompt(new OpencodeClient(endpoint.executor), {
      title: `任务总结 ${task.code} v${version}`.slice(0, 100),
      model: { id: endpoint.modelId, providerID: endpoint.providerId },
      location: endpoint.workdir
        ? { directory: endpoint.workdir }
        : endpoint.executor.defaultLocation
          ? { directory: endpoint.executor.defaultLocation }
          : undefined,
      prompt: this.buildPrompt(task, endpoint, events, messages, stats),
      timeoutMs: HANDOFF_TIMEOUT_MS,
    });
    const sections = splitHandoffSummary(raw);

    const now = new Date();
    const date = beijingDateStamp(now);
    let archivedVersion = version;
    let path = '';
    for (let attempt = 0; attempt < MAX_PATH_CONFLICT_RETRIES; attempt += 1) {
      path = `/task/handoff/${date}/${task.code}/${archivedVersion}.md`;
      const title = `${task.code} ${task.title} · 任务总结 v${archivedVersion}`;
      const content = this.buildReport({
        task,
        endpoint,
        events,
        stats,
        sections,
        path,
        version: archivedVersion,
        generatedAt: now,
      });
      try {
        await this.knowledge.createArticleAtPath({ path, title, content });
        await this.tasks.update(task.id, {
          handoffCount: archivedVersion + 1,
        });
        const url = `/docs/detail/${encodeKnowledgePath(path)}`;
        const chatContent = [
          content,
          '',
          '---',
          '',
          `📚 已归档到知识库：[${path}](${url})`,
        ].join('\n');
        await this.taskChat.postAssistantMessage(taskId, chatContent, {
          messageId,
          status: 'complete',
          meta: {
            handoff: {
              status: 'complete',
              version: archivedVersion,
              path,
              url,
              stats,
            },
          },
        });
        return {
          version: archivedVersion,
          path,
          title,
          url,
          content,
        };
      } catch (error) {
        if (
          error instanceof BadRequestException &&
          error.message.includes('已存在')
        ) {
          archivedVersion += 1;
          continue;
        }
        throw error;
      }
    }
    throw new BadRequestException('任务总结归档路径连续冲突，请稍后重试');
  }

  /** 报告消息 key：每个版本独立保留，后续重新生成不覆盖历史报告 */
  private handoffMessageId(taskId: number, version: number): string {
    return `chat:${taskId}:handoff:${version}`;
  }

  private assertCompleted(task: Task): void {
    if (
      task.status !== TaskStatus.FINISHED ||
      task.subStatus !== TaskSubStatus.COMPLETED
    ) {
      throw new BadRequestException(
        `任务 ${task.code} 当前状态「${task.status}-${task.subStatus}」不可生成总结`,
      );
    }
  }

  private async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }

  /** 任务自身统计：只统计当前任务，不聚合子任务 */
  private statsOf(task: Task, events: TaskEvent[]): TaskHandoffStats {
    const confirmations = events.filter(
      (event) =>
        event.type === '操作' && event.content.includes('回答机器人提问'),
    ).length;
    const supplements = events.filter((event) => event.type === '反馈').length;
    const endAt = task.acceptedAt ?? task.deliveredAt ?? new Date();
    const durationMs = Math.max(
      0,
      new Date(endAt).getTime() - new Date(task.createdAt).getTime(),
    );
    return { confirmations, supplements, durationMs };
  }

  /** 使用原任务机器人的执行器/模型/工位，独立会话总结，避免干扰原任务会话 */
  private async resolveEndpoint(task: Task): Promise<HandoffEndpoint> {
    const workerId = task.agentId ?? task.schedulerId;
    const worker = workerId
      ? await this.workers.findOne({ where: { id: workerId } })
      : null;
    const executorId = task.executorId ?? worker?.executorId ?? null;
    if (!executorId) {
      throw new BadRequestException(
        '任务没有可用于总结的执行器，请检查机器人配置',
      );
    }
    const executor = await this.executors.findOne({
      where: { id: executorId },
    });
    if (!executor) throw new BadRequestException('任务绑定的执行器不存在');
    if (!executor.online) {
      throw new BadRequestException(
        `执行器「${executor.name}」离线，无法生成任务总结`,
      );
    }

    let providerId = worker?.providerId?.trim() || '';
    let modelId = worker?.modelId?.trim() || '';
    if (!providerId || !modelId) {
      const provider = executor.providersCache?.find(
        (item) => item.models.length > 0,
      );
      providerId ||= provider?.id ?? '';
      modelId ||= provider?.models[0]?.id ?? '';
    }
    if (!providerId || !modelId) {
      throw new BadRequestException(
        `执行器「${executor.name}」没有可用模型，请先同步供应商`,
      );
    }
    return {
      worker,
      executor,
      providerId,
      modelId,
      workdir: worker ? this.workersService.workdirOf(worker.id) : null,
    };
  }

  private buildPrompt(
    task: Task,
    endpoint: HandoffEndpoint,
    events: TaskEvent[],
    messages: TaskMessage[],
    stats: TaskHandoffStats,
  ): string {
    const rawInput = this.originalInputOf(task, events);
    const organizedInput = task.content?.trim() || task.description?.trim();
    const recentEvents = events.slice(-MAX_EVENTS);
    const recentMessages = messages.slice(-MAX_MESSAGES);
    const eventLines = recentEvents.length
      ? recentEvents.map(
          (event) =>
            `- ${beijingTime(event.createdAt)} [${event.type}] ${
              event.operator ? `${event.operator}：` : ''
            }${clip(event.content, MAX_EVENT_CHARS)}${eventMetaSummary(event.meta)}`,
        )
      : ['（无事件记录）'];
    const messageLines = recentMessages.length
      ? recentMessages.map((message) => {
          const sender = message.sender?.name ?? message.role;
          const question = message.question
            ? `\n  问答：${message.question.questions
                .map(
                  (item, index) =>
                    `${item.header || item.question} → ${
                      message.question?.answers?.[index]?.join(' / ') ||
                      message.question?.state
                    }`,
                )
                .join('；')}`
            : '';
          return `- ${beijingTime(message.createdAt)} [${message.role}/${sender}] ${clip(
            message.content,
            MAX_MESSAGE_CHARS,
          )}${question}`;
        })
      : ['（无对话记录）'];

    return [
      HANDOFF_PROMPT,
      '',
      '---',
      '',
      '# 任务事实',
      '',
      `- 编号：${task.code}`,
      `- 标题：${task.title}`,
      `- 类型：${task.type}`,
      `- 机器人：${endpoint.worker?.name ?? '未记录（使用任务执行器）'}`,
      `- 创建时间：${beijingTime(task.createdAt)}`,
      `- 验收时间：${task.acceptedAt ? beijingTime(task.acceptedAt) : '未记录'}`,
      `- 验收人：${task.acceptedBy ?? '未记录'}`,
      '',
      '## 原始输入',
      '',
      rawInput || '（无）',
      '',
      '## 整理后的需求输入',
      '',
      organizedInput || '（无）',
      '',
      '## 输出要求',
      '',
      task.outputSpec?.trim() || '（无）',
      '',
      '## 最终交付物',
      '',
      clip(task.result, MAX_RESULT_CHARS) || '（无交付物记录）',
      '',
      '## 任务统计（平台确定值）',
      '',
      `- 用户确认次数：${stats.confirmations} 次`,
      `- 补充信息次数：${stats.supplements} 次`,
      `- 持续时长：${formatDuration(stats.durationMs)}`,
      '',
      '## 当前任务事件时间线',
      '',
      ...eventLines,
      '',
      '## 当前任务对话记录',
      '',
      ...messageLines,
    ]
      .join('\n')
      .slice(0, MAX_SUMMARY_CHARS);
  }

  private buildReport(input: {
    task: Task;
    endpoint: HandoffEndpoint;
    events: TaskEvent[];
    stats: TaskHandoffStats;
    sections: HandoffSections;
    path: string;
    version: number;
    generatedAt: Date;
  }): string {
    const { task, endpoint, events, stats, sections } = input;
    const rawInput = this.originalInputOf(task, events);
    const organizedInput = task.content?.trim() || task.description?.trim();
    const endAt = task.acceptedAt ?? task.deliveredAt;
    return [
      `# ${task.code} ${task.title} · 任务总结移交`,
      '',
      `> 报告版本：v${input.version} ｜ 生成时间：${beijingTime(input.generatedAt)} ｜ 归档路径：\`${input.path}\``,
      '',
      '## 任务信息',
      '',
      '| 字段 | 内容 |',
      '| --- | --- |',
      `| 任务编号 | ${task.code} |`,
      `| 任务标题 | ${task.title.replace(/\|/g, '\\|')} |`,
      `| 任务类型 | ${task.type} |`,
      `| 执行机器人 | ${(endpoint.worker?.name ?? '未记录').replace(/\|/g, '\\|')} |`,
      `| 创建时间 | ${beijingTime(task.createdAt)} |`,
      `| 验收时间 | ${endAt ? beijingTime(endAt) : '未记录'} |`,
      `| 验收人 | ${(task.acceptedBy ?? '未记录').replace(/\|/g, '\\|')} |`,
      '',
      '## 一、任务输入',
      '',
      '### 原始输入',
      '',
      rawInput || '（无）',
      '',
      '### 整理后的输入',
      '',
      organizedInput || '（无）',
      '',
      '## 二、交付物与结论',
      '',
      '### 最终交付物',
      '',
      clip(task.result, MAX_RESULT_CHARS) || '（无交付物记录）',
      '',
      '### 机器人总结',
      '',
      sections.delivery,
      '',
      '## 三、任务统计',
      '',
      '| 指标 | 数值 |',
      '| --- | --- |',
      `| 用户确认次数 | ${stats.confirmations} 次 |`,
      `| 补充信息次数 | ${stats.supplements} 次 |`,
      `| 持续时长 | ${formatDuration(stats.durationMs)} |`,
      `| 开始时间 | ${beijingTime(task.createdAt)} |`,
      `| 验收时间 | ${endAt ? beijingTime(endAt) : '未记录'} |`,
      '',
      '## 四、任务记录与过程复盘',
      '',
      sections.process,
      '',
      '## 五、经验总结',
      '',
      sections.lessons,
      '',
    ].join('\n');
  }

  /** 原始输入优先取识别前用户原文，避免把后续补充消息误当成原始需求 */
  private originalInputOf(task: Task, events: TaskEvent[]): string {
    if (task.input?.trim()) return task.input.trim();
    const created = events.find(
      (event) =>
        event.type === '操作' &&
        event.content.startsWith('创建任务') &&
        typeof event.meta?.description === 'string',
    );
    const description = created?.meta?.description;
    if (typeof description === 'string' && description.trim()) {
      return description.trim();
    }
    return task.description?.trim() || '';
  }
}

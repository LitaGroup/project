import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRuntime } from '../common/enums';
import { TaskTypesService } from '../task-types/task-types.service';
import { TASK_TYPE_DEFAULT, TaskType } from '../task-types/task-type.entity';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { WorkerView, WorkersService } from '../workers/workers.service';
import { Task, TaskMissingItem } from './task.entity';

/** 调度机器人识别结果：任务详情 + 工作计划，或需要用户补充/确认的反馈清单 */
export interface TaskIdentification {
  title?: string;
  /** 任务类型（task_types.name，未识别时回退默认「其它」） */
  type: string;
  input?: string;
  outputSpec?: string;
  /** 工作计划（Markdown） */
  workPlan?: string;
  /** 识别失败时用户需要补充/确认的事项 */
  feedback: TaskMissingItem[];
  /** 建议执行的机器人（workers.id，已在候选清单内校验） */
  agentId: number | null;
  agentName?: string;
  summary?: string;
}

/** 输出协议追加在调度机器人 PROMPT 之后，保证始终返回可解析 JSON */
const IDENTIFY_OUTPUT_CONTRACT = `# 输出协议（必须遵守）
只输出一个 JSON 对象，不要输出任何其它文字。结构：
{
  "title": "<任务标题>",
  "type": "<任务类型，取自给定任务类型清单>",
  "input": "<输入梳理>",
  "output": "<预期输出>",
  "workPlan": "<Markdown 工作计划>",
  "feedback": [{ "item": "<需要用户提供/确认的事项>", "reason": "<为什么需要>" }],
  "agentId": <机器人id>,
  "summary": "<一句话识别结论>"
}
信息充分时 feedback 为空数组；agentId 必须取自给定机器人清单。
不要调用任何工具、不要读写文件，直接输出 JSON。`;

/**
 * 调度机器人执行器调用：把任务识别交给系统调度机器人（opencode 执行器会话），
 * 轮询会话终态后取最后一条 assistant 文本，解析为结构化识别结果。
 */
@Injectable()
export class TaskIdentifyService {
  private readonly logger = new Logger(TaskIdentifyService.name);

  constructor(
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
    private readonly taskTypes: TaskTypesService,
  ) {}

  async identify(
    task: Task,
    scheduler: WorkerView,
    roster: WorkerView[],
    timeoutMs: number,
  ): Promise<TaskIdentification> {
    if (scheduler.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException(
        `调度机器人「${scheduler.name}」须运行在 opencode 等执行器上`,
      );
    }
    if (!scheduler.executorId) {
      throw new BadRequestException(
        `调度机器人「${scheduler.name}」未配置执行器，请在机器人页配置后启用`,
      );
    }
    if (!scheduler.providerId?.trim() || !scheduler.modelId?.trim()) {
      throw new BadRequestException(
        `调度机器人「${scheduler.name}」未配置供应商/模型`,
      );
    }
    const executor = await this.executors.findOne({
      where: { id: scheduler.executorId },
    });
    if (!executor) {
      throw new BadRequestException(
        `调度机器人「${scheduler.name}」配置的执行器不存在`,
      );
    }
    if (!executor.online) {
      throw new BadRequestException(
        `调度机器人「${scheduler.name}」的执行器「${executor.name}」离线`,
      );
    }

    const workdir =
      this.workersService.workdirOf(scheduler.id) ??
      executor.defaultLocation ??
      null;
    const client = new OpencodeClient(executor);
    const types = await this.taskTypes.findAll();
    const text = await runOpencodePrompt(client, {
      title: `识别 ${task.code} ${task.title}`.slice(0, 100),
      model: { id: scheduler.modelId, providerID: scheduler.providerId },
      location: workdir ? { directory: workdir } : undefined,
      prompt: this.buildPrompt(task, roster, types),
      timeoutMs,
    });
    this.logger.debug(
      `调度机器人原始输出（任务 ${task.code}）：${text.slice(0, 800)}`,
    );
    return this.parseIdentification(text, roster, types);
  }

  /** 调度机器人 PROMPT：输出协议 + 待识别任务与候选机器人（角色定义由工位 AGENTS.md 提供） */
  private buildPrompt(
    task: Task,
    roster: WorkerView[],
    types: TaskType[],
  ): string {
    const userPrompt = [
      '# 待识别任务',
      '',
      `- 编号：${task.code}`,
      `- 当前标题：${task.title}`,
      `- 当前登记类型：${task.type}`,
      task.description?.trim()
        ? `\n## 任务当前文字（识别输入）\n\n${task.description.trim()}`
        : '\n（任务当前文字为空）',
      task.input?.trim() ? `\n## 已有输入\n\n${task.input.trim()}` : '',
      task.outputSpec?.trim()
        ? `\n## 已有期望输出\n\n${task.outputSpec.trim()}`
        : '',
      '\n# 可选机器人清单',
      '',
      JSON.stringify(
        roster.map((w) => ({
          id: w.id,
          name: w.name,
          intro: w.intro,
          taskDefs: w.taskDefs ?? [],
          liveStatus: w.liveStatus,
        })),
        null,
        2,
      ),
      `\n# 任务类型（type 必须取以下名称之一）\n\n${
        types
          .map((t) => `- ${t.name}${t.description ? `：${t.description}` : ''}`)
          .join('\n') || `- ${TASK_TYPE_DEFAULT}`
      }`,
    ].join('\n');
    return [IDENTIFY_OUTPUT_CONTRACT, '', '---', '', userPrompt].join('\n');
  }

  /** 从回复文本提取并校验识别 JSON（兼容旧版 identification/missingItems/subtasks 字段） */
  private parseIdentification(
    text: string,
    roster: WorkerView[],
    types: TaskType[],
  ): TaskIdentification {
    const json = this.extractJson(text);
    if (!json) {
      throw new BadRequestException('调度机器人未返回有效的 JSON 识别结果');
    }
    const raw = json as {
      title?: unknown;
      type?: unknown;
      input?: unknown;
      output?: unknown;
      outputSpec?: unknown;
      workPlan?: unknown;
      plan?: unknown;
      feedback?: Array<{ item?: string; reason?: string }>;
      missingItems?: Array<{ item?: string; reason?: string }>;
      agentId?: unknown;
      agentName?: unknown;
      summary?: unknown;
      identification?: Record<string, unknown>;
      subtasks?: Array<Record<string, unknown>>;
    };
    const identification = raw.identification ?? {};
    const feedbackRaw = Array.isArray(raw.feedback)
      ? raw.feedback
      : Array.isArray(raw.missingItems)
        ? raw.missingItems
        : [];
    const feedback = feedbackRaw
      .filter((m) => str(m.item))
      .map((m) => ({ item: str(m.item)!, reason: str(m.reason) || undefined }));

    const subtasks = Array.isArray(raw.subtasks) ? raw.subtasks : [];
    const firstAgentId = Number(
      raw.agentId ?? subtasks.find((s) => s.agentId)?.agentId,
    );
    const agent = roster.find((w) => w.id === firstAgentId);
    const type = this.normalizeType(
      raw.type ?? identification.type ?? subtasks[0]?.type,
      types,
    );
    const workPlan =
      this.normalizeWorkPlan(raw.workPlan ?? raw.plan) ??
      this.workPlanFromSubtasks(subtasks);
    const title = str(raw.title ?? identification.title);
    const input = str(raw.input ?? identification.input);
    const outputSpec = str(
      raw.outputSpec ?? raw.output ?? identification.output,
    );
    const summary = str(raw.summary ?? identification.summary);

    // 有反馈时允许其它字段为空；无反馈时至少要能形成可执行的任务
    if (feedback.length === 0 && !title && !input && !outputSpec && !workPlan) {
      throw new BadRequestException(
        '调度机器人识别结果缺少任务详情（标题/输入/输出/工作计划均为空）',
      );
    }
    return {
      title: title || undefined,
      type,
      input: input || undefined,
      outputSpec: outputSpec || undefined,
      workPlan: workPlan || undefined,
      feedback,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? str(raw.agentName),
      summary,
    };
  }

  /** 工作计划归一化：字符串直接使用，数组转 Markdown 有序列表 */
  private normalizeWorkPlan(value: unknown): string | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    if (Array.isArray(value)) {
      const lines = value
        .map((item, index) => {
          if (typeof item === 'string') return `${index + 1}. ${item.trim()}`;
          if (item && typeof item === 'object') {
            const title = str((item as Record<string, unknown>).title);
            if (title) return `${index + 1}. ${title}`;
          }
          return '';
        })
        .filter(Boolean);
      return lines.length ? lines.join('\n') : undefined;
    }
    return undefined;
  }

  /** 兼容旧版调度输出：把 subtasks 拼成工作计划 */
  private workPlanFromSubtasks(
    subtasks: Array<Record<string, unknown>>,
  ): string | undefined {
    if (!subtasks.length) return undefined;
    return subtasks
      .map((sub, index) => {
        const title = str(sub.title) ?? `步骤 ${index + 1}`;
        const input = str(sub.input);
        const output = str(sub.outputSpec);
        const extra = [
          input ? `输入：${input}` : '',
          output ? `产出：${output}` : '',
        ]
          .filter(Boolean)
          .join('；');
        return `${index + 1}. ${title}${extra ? `（${extra}）` : ''}`;
      })
      .join('\n');
  }

  /** 提取文本中的 JSON 对象（优先 ```json 代码块，兜底首尾大括号截取） */
  private extractJson(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  /** 任务类型归一化到字典值（不在当前类型列表中的一律回退默认「其它」） */
  private normalizeType(value: unknown, types: TaskType[]): string {
    const v = str(value);
    if (!v) return TASK_TYPE_DEFAULT;
    return types.some((t) => t.name === v) ? v : TASK_TYPE_DEFAULT;
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t || undefined;
}

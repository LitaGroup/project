import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TaskType, WorkerRuntime } from '../common/enums';
import { Task } from '../tasks/task.entity';
import { WorkerView } from '../workers/workers.service';
import {
  DispatchPlanContent,
  PlanSubtask,
} from '../tasks/dispatch-plan.entity';

/** pi-ai 为纯 ESM 包，后端 CJS 运行时惰性动态加载（nodenext 保留 import()） */
type PiAiModule = typeof import('@mariozechner/pi-ai');

/** 调度器默认角色 PROMPT（调度器未自定义 prompt 时使用） */
const DEFAULT_SCHEDULER_PROMPT = `你是「调度器」，项目管理平台中负责任务分发的项目负责人角色。
你的职责：
1. 任务识别：判断任务类型（限定在给定枚举内）、梳理输入与期望输出；
2. 材料审查：判断当前输入是否足以开工，不足则列出缺失清单（缺失时不做拆解）；
3. 任务拆解与分配：任务可由单一机器人完成时给一条子任务；需要工作流时拆成多个子任务，
   并为每个子任务指定最合适的机器人（只能从给定清单中选择）。

输出要求：只输出一个 JSON 对象，不要输出任何其它文字。结构：
{
  "identification": { "type": "<任务类型>", "input": "<输入梳理>", "output": "<期望输出>", "summary": "<一句话结论>" },
  "missingItems": [{ "item": "<缺失材料>", "reason": "<为什么需要>" }],
  "subtasks": [{ "title": "<子任务标题>", "type": "<任务类型>", "input": "<给该子任务的输入>", "outputSpec": "<该子任务的产出要求>", "agentId": <机器人id>, "agentName": "<机器人名>" }]
}
规则：材料齐备时 missingItems 省略；材料缺失时 subtasks 给空数组；agentId 必须取自给定清单。`;

/** 角色 PROMPT 优化器：把机器人/调度器的角色定义整理为结构完整、无歧义的 Markdown */
const PROMPT_OPTIMIZE_SYSTEM = `你是资深 AI Agent 角色设计专家，负责优化机器人/调度器角色的 PROMPT（Markdown）。

优化要求：
1. 清晰化内容：消除歧义和模糊表述，统一术语，把“尽量/适当/等等”这类模糊要求改成明确的规则、边界和优先级；保留原始意图、业务事实与已有约束，不要臆造信息。
2. 结构上补全：输出必须包含以下五个二级标题，顺序固定：
## 角色定义
## 角色职责
## 背景知识
## 需要技能
## 接受任务
各小节要求：
- 角色定义：身份、定位、服务的对象与最终目标。
- 角色职责：可执行的职责清单，说明做什么、何时做、做到什么程度。
- 背景知识：完成任务所需的业务背景、领域知识、数据与系统约定。
- 需要技能：工具、技术栈、方法论与协作能力清单。
- 接受任务：可接受的任务类型、输入要求、产出要求、边界与拒收条件。
3. 若原文缺少某个小节的信息，不要编造，在该小节保留“（待补充：具体说明）”占位符。
4. 只输出优化后的 Markdown 正文，不要输出解释、前言、后记或代码块围栏。`;

/** PI 调度器：平台进程内的 AI 调度运行时（DeepSeek）。
 * 职责：任务识别 → 材料审查 → 拆解/分配建议，产出结构化调度方案（管理员确认后派发）；
 * 同时提供角色 PROMPT 优化能力。 */
@Injectable()
export class PiSchedulerService {
  private readonly logger = new Logger(PiSchedulerService.name);
  private piAiPromise: Promise<PiAiModule> | null = null;

  /** 惰性加载 pi-ai（纯 ESM，CJS 运行时只能动态 import） */
  private piAi(): Promise<PiAiModule> {
    this.piAiPromise ??= import('@mariozechner/pi-ai');
    return this.piAiPromise;
  }

  /** 跑一次调度：返回结构化方案内容（已校验归一化）。 */
  async schedule(
    task: Task,
    scheduler: WorkerView,
    roster: WorkerView[],
  ): Promise<DispatchPlanContent> {
    if (scheduler.runtime !== WorkerRuntime.PI) {
      throw new BadRequestException('调度器运行时须为 pi（进程内）');
    }
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException(
        '未配置 DEEPSEEK_API_KEY（后端 .env），无法运行 PI 调度器',
      );
    }
    const modelId = scheduler.modelId?.trim() || 'deepseek-v4-flash';
    if (scheduler.providerId && scheduler.providerId !== 'deepseek') {
      throw new BadRequestException('PI 调度器当前仅支持 deepseek 供应商');
    }
    const { complete, getModel } = await this.piAi();
    const model = getModel('deepseek', modelId as 'deepseek-v4-flash');

    const systemPrompt = scheduler.prompt?.trim() || DEFAULT_SCHEDULER_PROMPT;
    const userPrompt = [
      '# 待调度任务',
      '',
      `- 编号：${task.code}`,
      `- 标题：${task.title}`,
      `- 当前登记类型：${task.type}`,
      task.description?.trim()
        ? `\n## 任务描述\n\n${task.description.trim()}`
        : '',
      task.input?.trim()
        ? `\n## 任务输入\n\n${task.input.trim()}`
        : '\n（任务输入为空）',
      task.outputSpec?.trim()
        ? `\n## 期望输出\n\n${task.outputSpec.trim()}`
        : '\n（期望输出未明确，需要你梳理）',
      scheduler.materials?.trim()
        ? `\n# 调度材料（负责人提供）\n\n${scheduler.materials.trim()}`
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
      `\n# 任务类型枚举（identification.type 与 subtasks[].type 只能取）\n\n${Object.values(TaskType).join(' / ')}`,
    ].join('\n');

    const message = await complete(
      model,
      {
        systemPrompt,
        messages: [
          { role: 'user', content: userPrompt, timestamp: Date.now() },
        ],
      },
      { apiKey, temperature: 0.2 },
    );
    const text = this.textOf(message);
    if (!text.trim()) {
      throw new BadRequestException(
        '调度器无输出（检查 DeepSeek 供应商额度/模型是否可用）',
      );
    }
    this.logger.debug(
      `PI 调度原始输出（任务 ${task.code}）：${text.slice(0, 800)}`,
    );
    return this.parsePlan(text, roster);
  }

  /** 优化角色 PROMPT：返回结构完整的 Markdown（不含代码块围栏）。 */
  async optimizePrompt(markdown: string): Promise<string> {
    const content = typeof markdown === 'string' ? markdown.trim() : '';
    if (!content) {
      throw new BadRequestException('PROMPT 内容不能为空');
    }
    const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
    if (!apiKey) {
      throw new BadRequestException(
        '未配置 DEEPSEEK_API_KEY（后端 .env），无法调用 PI Agent 优化 PROMPT',
      );
    }
    const { complete, getModel } = await this.piAi();
    const model = getModel('deepseek', 'deepseek-v4-flash');
    const message = await complete(
      model,
      {
        systemPrompt: PROMPT_OPTIMIZE_SYSTEM,
        messages: [
          {
            role: 'user',
            content: `请优化以下角色 PROMPT：\n\n${content}`,
            timestamp: Date.now(),
          },
        ],
      },
      { apiKey, temperature: 0.3 },
    );
    const text = this.textOf(message);
    if (!text.trim()) {
      throw new BadRequestException(
        'PI Agent 无输出（检查 DeepSeek 供应商额度/模型是否可用）',
      );
    }
    return this.stripFence(text);
  }

  /** 去掉模型偶尔包裹的 ```markdown 代码围栏 */
  private stripFence(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    return (fenced ? fenced[1] : trimmed).trim();
  }

  /** AssistantMessage → 文本（content 兼容字符串与分段数组；TextContent 字段为 text） */
  private textOf(message: {
    content: string | Array<{ type: string; text?: string }>;
    stopReason?: string;
    errorMessage?: string;
  }): string {
    if (typeof message.content === 'string') return message.content;
    const text = message.content
      .filter((p) => p.type === 'text' && p.text)
      .map((p) => p.text!)
      .join('\n');
    if (!text) {
      this.logger.warn(
        `PI 调度器无文本输出（stopReason=${message.stopReason ?? '-'}${message.errorMessage ? `，error=${message.errorMessage}` : ''}）`,
      );
    }
    return text;
  }

  /** 从回复文本提取并校验方案 JSON（容忍 ```json 包裹与前后废话） */
  private parsePlan(text: string, roster: WorkerView[]): DispatchPlanContent {
    const json = this.extractJson(text);
    if (!json) {
      throw new BadRequestException('调度器未返回有效的 JSON 方案');
    }
    const raw = json as {
      identification?: Record<string, unknown>;
      missingItems?: Array<{ item?: string; reason?: string }>;
      subtasks?: Array<Record<string, unknown>>;
    };
    const identification = {
      type: this.normalizeType(raw.identification?.type),
      input: str(raw.identification?.input),
      output: str(raw.identification?.output),
      summary: str(raw.identification?.summary),
    };
    const missingItems = (raw.missingItems ?? [])
      .filter((m) => str(m.item))
      .map((m) => ({ item: str(m.item)!, reason: str(m.reason) || undefined }));
    const rosterIds = new Set(roster.map((w) => w.id));
    const subtasks: PlanSubtask[] = (raw.subtasks ?? [])
      .map((s) => {
        const agentId = Number(s.agentId);
        const agent = roster.find((w) => w.id === agentId);
        return {
          title: str(s.title) ?? '未命名子任务',
          type: this.normalizeType(s.type),
          input: str(s.input) || undefined,
          outputSpec: str(s.outputSpec) || undefined,
          agentId: rosterIds.has(agentId) ? agentId : null,
          agentName: agent?.name ?? str(s.agentName) ?? undefined,
        };
      })
      .filter((s) => s.title);
    if (missingItems.length === 0 && subtasks.length === 0) {
      throw new BadRequestException(
        '调度方案缺少内容（无缺失清单也无子任务拆解），请检查调度器配置',
      );
    }
    return {
      identification,
      missingItems: missingItems.length ? missingItems : undefined,
      subtasks,
    };
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

  /** 任务类型归一化到枚举（不认识的一律「其它」） */
  private normalizeType(value: unknown): TaskType {
    const v = str(value);
    if (!v) return TaskType.OTHER;
    return (Object.values(TaskType) as string[]).includes(v)
      ? (v as TaskType)
      : TaskType.OTHER;
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.trim();
  return t || undefined;
}

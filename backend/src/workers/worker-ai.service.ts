import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { Worker } from './worker.entity';
import { WorkersService } from './workers.service';
import { isSystemWorkerId } from './system-workers';

export interface OptimizePromptInput {
  prompt?: string;
  /** 正在编辑的机器人（优先用其执行器/模型与工位） */
  workerId?: number | null;
  /** 表单当前选择的执行器/供应商/模型（新建机器人尚未保存时使用） */
  executorId?: number | null;
  providerId?: string | null;
  modelId?: string | null;
}

/** AGENTS.md 优化器：把机器人/调度机器人的角色定义整理为结构完整、无歧义的 Markdown */
const PROMPT_OPTIMIZE_SYSTEM = `你是资深 AI Agent 角色设计专家，负责优化机器人/调度机器人角色的 PROMPT（Markdown）。

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
4. 只输出优化后的 Markdown 正文，不要输出解释、前言、后记或代码块围栏。
5. 不要调用任何工具，直接输出结果。`;

/**
 * 机器人 AI 能力（统一走 opencode 等执行器，不再使用平台进程内 PI Agent）。
 * 目前提供机器人 AGENTS.md 优化。
 */
@Injectable()
export class WorkerAiService {
  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
  ) {}

  async optimizePrompt(input: OptimizePromptInput): Promise<string> {
    const content = input.prompt?.trim();
    if (!content) {
      throw new BadRequestException('PROMPT 内容不能为空');
    }
    const { executor, providerId, modelId, location } =
      await this.resolveEndpoint(input);
    const text = await runOpencodePrompt(new OpencodeClient(executor), {
      title: '优化机器人 AGENTS.md',
      model: { id: modelId, providerID: providerId },
      location,
      prompt: `${PROMPT_OPTIMIZE_SYSTEM}\n\n---\n\n请优化以下机器人 AGENTS.md：\n\n${content}`,
      timeoutMs: 5 * 60_000,
    });
    return this.stripFence(text);
  }

  /** 执行器/模型解析：表单选择 → 当前机器人 → 系统调度机器人 → 首个在线执行器 */
  private async resolveEndpoint(input: OptimizePromptInput): Promise<{
    executor: Executor;
    providerId: string;
    modelId: string;
    location?: { directory: string };
  }> {
    const worker = input.workerId
      ? await this.workers.findOne({ where: { id: input.workerId } })
      : null;
    let providerId = input.providerId?.trim() || null;
    let modelId = input.modelId?.trim() || null;

    let executor = input.executorId
      ? await this.executors.findOne({ where: { id: input.executorId } })
      : null;
    if (!executor && worker?.executorId) {
      executor = await this.executors.findOne({
        where: { id: worker.executorId },
      });
      if (executor) {
        providerId ??= worker.providerId;
        modelId ??= worker.modelId;
      }
    }
    if (!executor) {
      const scheduler = await this.workers.findOne({
        where: { role: WorkerRole.SCHEDULER },
        order: { id: 'ASC' },
      });
      if (scheduler?.executorId) {
        executor = await this.executors.findOne({
          where: { id: scheduler.executorId },
        });
        if (executor) {
          providerId ??= scheduler.providerId;
          modelId ??= scheduler.modelId;
        }
      }
    }
    if (!executor) {
      // 兜底执行器不继承其它机器人的供应商/模型，按该执行器缓存选择
      executor = await this.executors.findOne({
        where: { enabled: true, online: true },
        order: { id: 'ASC' },
      });
    }
    if (!executor) {
      throw new BadRequestException(
        '没有可用于优化的执行器，请先登记并上线执行器，或在表单中选择执行器',
      );
    }
    if (!executor.online) {
      throw new BadRequestException(
        `执行器「${executor.name}」离线，无法优化 PROMPT`,
      );
    }
    if (!providerId || !modelId) {
      const provider = executor.providersCache?.find(
        (item) => item.models.length > 0,
      );
      providerId ??= provider?.id ?? null;
      modelId ??= provider?.models[0]?.id ?? null;
    }
    if (!providerId || !modelId) {
      throw new BadRequestException(
        `执行器「${executor.name}」没有可用的供应商/模型缓存，请先同步供应商`,
      );
    }
    const workdir =
      worker && isSystemWorkerId(worker.id)
        ? this.workersService.workdirOf(worker.id)
        : null;
    return {
      executor,
      providerId,
      modelId,
      location: workdir ? { directory: workdir } : undefined,
    };
  }

  /** 去掉模型偶尔包裹的 ```markdown 代码围栏 */
  private stripFence(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/);
    return (fenced ? fenced[1] : trimmed).trim();
  }
}

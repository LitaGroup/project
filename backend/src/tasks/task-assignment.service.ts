import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { TaskTemplate } from './task-template.entity';
import { Task } from './task.entity';
import {
  SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
  SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
} from './system-task-templates';

export type TaskAssignmentSource = 'manual' | 'definition' | 'unknown';

export interface TaskAssignmentResult {
  agentId: number | null;
  agentName: string | null;
  templateId: number | null;
  templateName: string | null;
  source: TaskAssignmentSource;
}

/**
 * 任务识别分配：不调用机器人，完全由平台本地数据完成。
 * 优先级：人工预分配 → 所选任务定义 → 系统未知任务定义（ID=6）。
 */
@Injectable()
export class TaskAssignmentService {
  constructor(
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  async assign(task: Task): Promise<TaskAssignmentResult> {
    const template = task.templateId
      ? await this.templates.findOne({ where: { id: task.templateId } })
      : null;
    const enabledWorkers = await this.workers.find({
      // 个人 AGENT 只承载「我的 AI」对话，不承接任务
      where: {
        role: WorkerRole.WORKER,
        enabled: true,
        personalAgentUserId: IsNull(),
      },
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    const workerById = new Map(
      enabledWorkers.map((worker) => [worker.id, worker]),
    );
    const templateRef = (value: TaskTemplate | null) => ({
      templateId: value?.id ?? task.templateId ?? null,
      templateName: value?.name ?? task.templateName ?? null,
    });

    // 1. 创建/编辑时显式指定的机器人优先保留
    if (task.agentId) {
      const manual = workerById.get(task.agentId);
      if (manual) {
        return {
          agentId: manual.id,
          agentName: manual.name,
          ...templateRef(template),
          source: 'manual',
        };
      }
    }

    // 2. 所选任务定义配置的默认处理机器人
    if (template) {
      const agent = this.firstEnabled(template.agentIds, workerById);
      if (agent) {
        return {
          agentId: agent.id,
          agentName: agent.name,
          ...templateRef(template),
          source: 'definition',
        };
      }
      // 项目开发交付只允许系统项目经理承接；未启用时等待配置
      if (template.id === SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID) {
        return {
          agentId: null,
          agentName: null,
          ...templateRef(template),
          source: 'definition',
        };
      }
    }

    // 3. 无法匹配：归入未知任务，交给系统未知任务定义（固定 ID=6）的启用机器人
    const unknown = await this.templates.findOne({
      where: { id: SYSTEM_UNKNOWN_TASK_TEMPLATE_ID },
    });
    const agent = unknown
      ? this.firstEnabled(unknown.agentIds, workerById)
      : null;
    return {
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      templateId: unknown?.id ?? null,
      templateName: unknown?.name ?? null,
      source: 'unknown',
    };
  }

  private firstEnabled(
    ids: number[] | null | undefined,
    workerById: Map<number, Worker>,
  ): Worker | null {
    for (const id of ids ?? []) {
      const worker = workerById.get(id);
      if (worker) return worker;
    }
    return null;
  }
}

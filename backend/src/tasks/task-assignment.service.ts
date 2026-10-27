import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import {
  TASK_TYPE_DEFAULT,
  TASK_TYPE_UNKNOWN,
} from '../task-types/task-type.entity';
import { Worker } from '../workers/worker.entity';
import { TaskTemplate } from './task-template.entity';
import { Task } from './task.entity';
import { SYSTEM_UNKNOWN_TASK_TEMPLATE_ID } from './system-task-templates';

export type TaskAssignmentSource =
  'manual' | 'definition' | 'type-definition' | 'type-worker' | 'unknown';

export interface TaskAssignmentResult {
  type: string;
  agentId: number | null;
  agentName: string | null;
  templateId: number | null;
  templateName: string | null;
  source: TaskAssignmentSource;
  /** 进入未知任务前尝试匹配的类型 */
  originalType?: string;
}

/**
 * 任务识别分配：不调用机器人，完全由平台本地数据完成。
 * 优先级：人工预分配 → 所选任务定义 → 同类型任务定义 → 机器人任务定义 → 系统未知任务定义（ID=6）。
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
    // 「其它」是未指定类型时的默认值，不参与自动匹配，否则会被误分配给通用任务定义
    const taskType = task.type?.trim();
    const preferredType =
      template?.type ??
      (taskType && taskType !== TASK_TYPE_DEFAULT ? taskType : '');
    const enabledWorkers = await this.workers.find({
      where: { role: WorkerRole.WORKER, enabled: true },
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
        const type =
          template?.type ??
          (task.type && task.type !== TASK_TYPE_DEFAULT
            ? task.type
            : (manual.taskDefs ?? []).find((definition) => definition?.type)
                ?.type) ??
          task.type;
        return {
          type,
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
          type: template.type,
          agentId: agent.id,
          agentName: agent.name,
          ...templateRef(template),
          source: 'definition',
        };
      }
    }

    // 3. 同任务类型的其他任务定义
    if (preferredType) {
      const candidates = await this.templates.find({
        where: { type: preferredType },
        order: { updatedAt: 'DESC', id: 'DESC' },
      });
      for (const candidate of candidates) {
        const agent = this.firstEnabled(candidate.agentIds, workerById);
        if (!agent) continue;
        return {
          type: candidate.type,
          agentId: agent.id,
          agentName: agent.name,
          ...templateRef(candidate),
          source: 'type-definition',
        };
      }

      // 4. 机器人自己声明的任务定义类型
      const worker = enabledWorkers.find((item) =>
        (item.taskDefs ?? []).some(
          (definition) => definition?.type === preferredType,
        ),
      );
      if (worker) {
        return {
          type: preferredType,
          agentId: worker.id,
          agentName: worker.name,
          ...templateRef(template),
          source: 'type-worker',
        };
      }
    }

    // 5. 无法匹配：归入未知任务，交给系统未知任务定义（固定 ID=6）的启用机器人
    const unknown = await this.templates.findOne({
      where: { id: SYSTEM_UNKNOWN_TASK_TEMPLATE_ID },
    });
    const agent = unknown
      ? this.firstEnabled(unknown.agentIds, workerById)
      : null;
    return {
      type: TASK_TYPE_UNKNOWN,
      agentId: agent?.id ?? null,
      agentName: agent?.name ?? null,
      templateId: unknown?.id ?? null,
      templateName: unknown?.name ?? null,
      source: 'unknown',
      originalType: preferredType || task.type,
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

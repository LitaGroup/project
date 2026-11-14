import { Injectable } from '@nestjs/common';
import type { Task } from './task.entity';
import type { TaskActor } from './task-requester';

/** 任务话题联动事件（不直接依赖 TopicsService，避免任务模块与话题模块循环依赖） */
export type TaskTopicHookEvent =
  | {
      type: 'question-answered';
      taskId: number;
      questionId: string;
      actor: TaskActor;
      answers?: string[][];
      rejected: boolean;
    }
  | {
      type: 'acceptance-rejected';
      task: Task;
      actor: TaskActor;
      content: string;
    }
  | {
      type: 'turn-finished';
      taskId: number;
      error?: string;
    };

export interface TaskTopicHookResult {
  /** 事件对应的话题 id（用于把话题回复要求写入任务恢复提示） */
  topicId?: number;
}

/**
 * 任务 → 话题挂接点：TaskCollaborationService / TaskDeliveryService 只负责发事件，
 * TopicsService 在启动时注册处理函数并负责落库。
 */
@Injectable()
export class TaskTopicHooksService {
  private handler:
    | ((event: TaskTopicHookEvent) => Promise<TaskTopicHookResult | void>)
    | null = null;

  register(
    handler: (event: TaskTopicHookEvent) => Promise<TaskTopicHookResult | void>,
  ): void {
    this.handler = handler;
  }

  async emit(event: TaskTopicHookEvent): Promise<TaskTopicHookResult | void> {
    if (!this.handler) return;
    return this.handler(event);
  }
}

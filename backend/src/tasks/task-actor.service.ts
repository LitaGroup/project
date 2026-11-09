import { ForbiddenException, Injectable } from '@nestjs/common';
import type { User } from '../auth/user.entity';
import { PersonalAgentsService } from '../workers/personal-agents.service';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import {
  isTaskRequester,
  TaskActor,
  workerRequesterActor,
} from './task-requester';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

/** 任务动作调用方（网页请求 / MCP 令牌映射后的身份） */
export interface TaskActorPrincipal {
  worker?: Worker;
  user?: User;
}

/**
 * 任务动作身份解析（网页控制器与 MCP 工具共用）：
 * - 机器人令牌优先；个人 AGENT 统一映射为其主人的真人机器人；
 * - 用户令牌按「真人机器人需求方 → 个人 AGENT 历史需求方 → 用户本人」回退。
 */
@Injectable()
export class TaskActorService {
  constructor(
    private readonly tasks: TasksService,
    private readonly workers: WorkersService,
    private readonly personalAgents: PersonalAgentsService,
  ) {}

  /** 仅机器人可执行的动作（接受/拒绝/提问/交付/申请验收等） */
  requireWorker(principal: TaskActorPrincipal): Worker {
    if (!principal.worker) {
      throw new ForbiddenException('该操作仅接受机器人身份（X-Worker-Token）');
    }
    return principal.worker;
  }

  /** 需求方动作身份（答复提问、回复消息、验收、返工、判失败） */
  async resolveRequesterActor(
    principal: TaskActorPrincipal,
    taskId: number,
  ): Promise<TaskActor> {
    if (principal.worker) {
      // 个人 AGENT 只作「我的 AI」通道：需求方动作统一按主人的真人机器人执行
      if (principal.worker.personalAgentUserId) {
        const human = await this.workers.findByHumanUserId(
          principal.worker.personalAgentUserId,
        );
        if (human) return workerRequesterActor(human, principal.worker);
      }
      return workerRequesterActor(principal.worker);
    }
    if (!principal.user) throw new ForbiddenException('缺少任务需求方身份');
    const task = await this.tasks.mustFind(taskId);
    const humanWorker = await this.workers.findByHumanUserId(principal.user.id);
    if (
      humanWorker &&
      task.requesterType === 'worker' &&
      task.requesterId === humanWorker.id
    ) {
      return workerRequesterActor(humanWorker);
    }
    const personalAgent = await this.personalAgents.findForUser(
      principal.user.id,
    );
    if (
      personalAgent &&
      task.requesterType === 'worker' &&
      task.requesterId === personalAgent.id
    ) {
      // 历史任务需求方是个人 AGENT：由主人的真人机器人操作，
      // 并保留个人 AGENT Worker ID 作为需求方归属校验别名。
      return humanWorker
        ? workerRequesterActor(humanWorker, personalAgent)
        : workerRequesterActor(personalAgent);
    }
    return { type: 'user', user: principal.user };
  }

  /**
   * 任务文档写入者：机器人令牌只能维护自己执行或自己作为需求方的任务文档；
   * 用户令牌按平台既有权限处理（与任务文档接口一致）。
   */
  async resolveDocumentAuthor(
    task: Task,
    principal: TaskActorPrincipal,
  ): Promise<string> {
    if (!principal.worker) return principal.user?.name ?? '系统';
    const worker = principal.worker;
    // 个人 AGENT 仅是用户的 AI 对话通道：文档作者统一按主人的真人机器人身份校验
    const actorWorker = worker.personalAgentUserId
      ? ((await this.workers.findByHumanUserId(worker.personalAgentUserId)) ??
        worker)
      : worker;
    const actor = workerRequesterActor(
      actorWorker,
      worker.personalAgentUserId ? worker : null,
    );
    const isExecutor = task.agentId === actorWorker.id;
    const isRequester = isTaskRequester(task, actor);
    if (!isExecutor && !isRequester) {
      throw new ForbiddenException(
        '仅任务执行机器人或需求方机器人可以维护任务文档',
      );
    }
    return actorWorker.name;
  }
}

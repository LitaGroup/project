import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { mdFrontmatter } from '../common/frontmatter';
import type { Worker } from '../workers/worker.entity';
import { Task } from './task.entity';
import { TaskDispatchService } from './task-dispatch.service';
import { TaskHandoffService } from './task-handoff.service';
import { TasksService } from './tasks.service';

export interface DeliveryReplyInput {
  /** accept=通过验收；refuse=拒绝并退回执行 */
  action?: string;
  /** 拒绝验收时的反馈意见（必填） */
  content?: string;
}

function markdownText(value: string | null | undefined): string {
  return value?.trim() || '（暂无）';
}

/**
 * 任务交付验收的 Agent 接口：
 * - 执行机器人申请验收（task-deliver-apply）
 * - 任务需求方处理验收（task-deliver-reply）
 */
@Injectable()
export class TaskDeliveryService {
  private readonly logger = new Logger(TaskDeliveryService.name);
  private readonly apiUrl: string;

  constructor(
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly tasksService: TasksService,
    private readonly dispatchService: TaskDispatchService,
    private readonly taskHandoff: TaskHandoffService,
    config: ConfigService,
  ) {
    this.apiUrl = (
      config.get<string>('API_URL') ?? 'http://localhost:3100/api'
    ).replace(/\/+$/, '');
  }

  /** 执行机器人申请验收：只保存产出并进入等待中-待验收 */
  async apply(taskId: number, worker: Worker): Promise<string> {
    const task = await this.mustFind(taskId);
    if (task.agentId !== worker.id) {
      throw new ForbiddenException(
        `任务 ${task.code} 的执行机器人不是「${worker.name}」`,
      );
    }
    const applied = await this.dispatchService.applyForAcceptance(
      taskId,
      worker,
    );
    const saved = applied.task;
    const requesterId = await this.requesterUserId(saved);
    const requester = requesterId ? await this.userName(requesterId) : null;
    return [
      mdFrontmatter({
        update: saved.updatedAt,
        title: '任务验收申请已提交',
      }),
      '# 任务验收申请已提交',
      '',
      `- ID：${saved.id}`,
      `- 编号：${saved.code}`,
      `- 状态：${saved.status}-${saved.subStatus}`,
      `- 执行机器人：${worker.name}（${worker.id}）`,
      `- 需求方：${requester ?? '未记录'}`,
      `- 交付文档：[${applied.handoff.path}](${applied.handoff.url})`,
      '',
      '## 交付物',
      '',
      markdownText(saved.result),
      '',
      '## 后续处理',
      '',
      `需求方通过：POST ${this.apiUrl}/tasks/${saved.id}/deliver/reply.md，body {"action":"accept"}`,
      '',
      `需求方拒绝：POST ${this.apiUrl}/tasks/${saved.id}/deliver/reply.md，body {"action":"refuse","content":"反馈意见"}`,
      '',
    ].join('\n');
  }

  /** 需求方处理验收：通过则完成并生成总结；拒绝则退回原执行机器人 */
  async reply(
    taskId: number,
    actor: User,
    input: DeliveryReplyInput,
  ): Promise<string> {
    const task = await this.mustFind(taskId);
    const requesterId = await this.requesterUserId(task);
    if (!requesterId || actor.id !== requesterId) {
      throw new ForbiddenException('仅任务需求方可以处理验收反馈');
    }
    const action = input.action?.trim();
    if (action !== 'accept' && action !== 'refuse') {
      throw new BadRequestException('action 只支持 accept 或 refuse');
    }

    if (action === 'accept') {
      const saved = await this.tasksService.accept(taskId, actor.name ?? null);
      // 验收成功后的总结与会话清理均为异步收尾，不阻塞验收结果
      void this.taskHandoff.request(taskId).catch((error: Error) => {
        this.logger.warn(
          `任务 ${saved.code} 验收后启动总结失败：${error.message}`,
        );
      });
      void this.dispatchService
        .destroyAcceptedSession(taskId)
        .catch((error: Error) => {
          this.logger.warn(
            `任务 ${saved.code} 验收后销毁执行器会话失败：${error.message}`,
          );
        });
      return [
        mdFrontmatter({
          update: saved.updatedAt,
          title: '任务验收已通过',
        }),
        '# 任务验收已通过',
        '',
        `- ID：${saved.id}`,
        `- 编号：${saved.code}`,
        `- 状态：${saved.status}-${saved.subStatus}`,
        `- 验收人：${actor.name ?? '未知'}`,
        '',
        '任务已完成，平台正在异步生成 REVIEW.md 复盘文档。',
        '',
      ].join('\n');
    }

    const content = input.content?.trim();
    if (!content) {
      throw new BadRequestException('拒绝验收时必须提供反馈意见 content');
    }
    const saved = await this.dispatchService.continueConversation(
      taskId,
      content,
      actor.name ?? null,
    );
    await this.dispatchService.addEvent(
      taskId,
      '操作',
      '需求方拒绝验收，已退回执行机器人重新处理',
      actor.name ?? null,
      {
        intervention: true,
        deliveryReply: 'refuse',
        feedback: content,
      },
    );
    return [
      mdFrontmatter({
        update: saved.updatedAt,
        title: '任务验收已拒绝',
      }),
      '# 任务验收已拒绝',
      '',
      `- ID：${saved.id}`,
      `- 编号：${saved.code}`,
      `- 状态：${saved.status}-${saved.subStatus}`,
      `- 验收人：${actor.name ?? '未知'}`,
      '',
      '## 反馈意见',
      '',
      content,
      '',
      '任务已退回原执行机器人继续处理，完成后需重新申请验收。',
      '',
    ].join('\n');
  }

  /** 需求方：任务创建人优先；子任务回退根任务创建人 */
  private async requesterUserId(task: Task): Promise<number | null> {
    if (task.createdById && task.createdById > 0) return task.createdById;
    if (!task.rootId || task.rootId === task.id) return null;
    const root = await this.tasks.findOne({
      where: { id: task.rootId },
      select: { id: true, createdById: true },
    });
    return root?.createdById && root.createdById > 0 ? root.createdById : null;
  }

  private async userName(userId: number): Promise<string | null> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, name: true },
    });
    return user?.name ?? null;
  }

  private async mustFind(taskId: number): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`Task ${taskId} not found`);
    return task;
  }
}

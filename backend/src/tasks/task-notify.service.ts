import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { Worker } from '../workers/worker.entity';
import { WorkersService } from '../workers/workers.service';
import { FeishuService } from '../feishu/feishu.service';
import { Task } from './task.entity';

export type TaskNotifyKind = 'feedback' | 'accept' | 'notice';

export interface TaskNotifyResult {
  /** 是否成功发送（找不到负责人或飞书失败均为 false） */
  sent: boolean;
  /** 接收人姓名（找到负责人时返回，便于事件记录） */
  ownerName?: string;
}

/**
 * 任务通知：
 * - 待反馈优先通知历史调度机器人负责人，其次处理机器人负责人；
 * - 待验收优先通知任务需求方（任务创建人，子任务回退根任务创建人），
 *   无有效需求方时回退机器人负责人。
 */
@Injectable()
export class TaskNotifyService {
  private readonly logger = new Logger(TaskNotifyService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly workersService: WorkersService,
    private readonly feishuService: FeishuService,
    config: ConfigService,
  ) {
    this.appUrl = (
      config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/$/, '');
  }

  async notifyTaskOwner(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    const receiver = await this.resolveReceiver(task, kind);
    if (!receiver) {
      this.logger.warn(
        `任务 ${task.code} 待处理提醒未发送：未找到机器人/调度机器人负责人`,
      );
      return { sent: false };
    }
    return this.sendCard(task, receiver, kind, title, description, '负责人');
  }

  /**
   * 需求方通知：优先任务创建用户，子任务回退根任务创建用户。
   * 未找到有效用户时回退机器人负责人，避免待验收提醒完全丢失。
   */
  async notifyTaskRequester(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    const requesterId = await this.resolveRequesterUserId(task);
    if (requesterId) {
      const user = await this.users.findOne({
        where: { id: requesterId },
        select: { id: true, name: true, feishuOpenId: true },
      });
      if (user?.feishuOpenId) {
        return this.sendCard(
          task,
          { openId: user.feishuOpenId, ownerName: user.name },
          kind,
          title,
          description,
          '需求方',
        );
      }
    }
    return this.notifyTaskOwner(task, kind, title, description);
  }

  /** 需求方用户 id：当前任务创建人优先，子任务回退根任务创建人 */
  async resolveRequesterUserId(task: Task): Promise<number | null> {
    if (task.createdById && task.createdById > 0) return task.createdById;
    if (!task.rootId || task.rootId === task.id) return null;
    const root = await this.tasks.findOne({
      where: { id: task.rootId },
      select: { id: true, createdById: true },
    });
    return root?.createdById && root.createdById > 0 ? root.createdById : null;
  }

  private async sendCard(
    task: Task,
    receiver: { openId: string; ownerName: string },
    kind: TaskNotifyKind,
    title: string,
    description: string,
    receiverLabel: '负责人' | '需求方',
  ): Promise<TaskNotifyResult> {
    const template = kind === 'accept' ? 'green' : 'orange';

    const statusLabel = `${task.status}-${task.subStatus}`;
    try {
      await this.feishuService.sendUserCard(receiver.openId, {
        config: { wide_screen_mode: true },
        header: {
          // 飞书卡片标题不宜过长，任务全名在正文中完整展示
          title: { tag: 'plain_text', content: title.slice(0, 80) },
          template,
        },
        elements: [
          {
            tag: 'div',
            text: {
              tag: 'lark_md',
              content: [
                `**任务**：${task.code} ${task.title}`,
                `**状态**：${statusLabel}`,
                `**${receiverLabel}**：${receiver.ownerName}`,
                `**说明**：${description}`,
              ].join('\n'),
            },
          },
          {
            tag: 'action',
            actions: [
              {
                tag: 'button',
                text: { tag: 'plain_text', content: '打开任务详情' },
                type: 'primary',
                url: `${this.appUrl}/tasks/${task.id}`,
              },
            ],
          },
        ],
      });
      return { sent: true, ownerName: receiver.ownerName };
    } catch (e) {
      this.logger.warn(
        `任务 ${task.code} ${receiverLabel}通知失败（${receiver.ownerName}）: ${(e as Error).message}`,
      );
      return { sent: false, ownerName: receiver.ownerName };
    }
  }

  /** 收件人解析：按通知场景决定 机器人/调度机器人 负责人优先级 */
  private async resolveReceiver(
    task: Task,
    kind: TaskNotifyKind,
  ): Promise<{ openId: string; ownerName: string } | null> {
    const agentFirst = kind !== 'feedback';
    const candidates = agentFirst
      ? [task.agentId, task.schedulerId]
      : [task.schedulerId, task.agentId];
    const seen = new Set<number>();
    for (const id of candidates) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const worker = await this.workers.findOne({ where: { id } });
      if (!worker) continue;
      const openId = await this.workersService.ownerOpenId(worker);
      if (openId) return { openId, ownerName: worker.ownerName ?? worker.name };
    }
    return null;
  }
}

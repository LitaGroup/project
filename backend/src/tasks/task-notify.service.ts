import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import { WorkerRuntime } from '../common/enums';
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

export interface TaskRequesterNotifyOptions {
  /**
   * 普通 AI 机器人需求方没有绑定用户时，是否回退通知其负责人。
   * 仅用于自动处理失败、人工介入等升级场景；正常待验收/待反馈不打扰负责人。
   */
  fallbackToRequesterOwner?: boolean;
}

/**
 * 任务通知：
 * - 待反馈优先通知历史调度机器人负责人，其次处理机器人负责人；
 * - 待验收通知真实需求方（人、真人机器人绑定用户或个人 AGENT 主人）；
 *   普通 AI 机器人需求方由收件箱/自动验收驱动，正常通知不打扰其负责人；
 * - 未找到有效需求方时回退执行机器人负责人，避免异常提醒完全丢失。
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
   * 真人机器人需求方通知其绑定用户；普通 AI 机器人需求方由收件箱与自动验收驱动，
   * 正常通知不打扰负责人，只有显式的人工兜底场景才回退通知其负责人。
   */
  async notifyTaskRequester(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
    options?: TaskRequesterNotifyOptions,
  ): Promise<TaskNotifyResult> {
    // 真人机器人需求方仍由其绑定用户在操作台处理；AI 机器人需求方由收件箱和 LOOP 唤醒。
    if (task.requesterType === 'worker' && task.requesterId) {
      const requesterWorker = await this.workers.findOne({
        where: { id: task.requesterId },
        select: {
          id: true,
          name: true,
          humanUserId: true,
          personalAgentUserId: true,
          runtime: true,
          ownerUserId: true,
          ownerName: true,
        },
      });
      const boundUserId =
        requesterWorker?.runtime === WorkerRuntime.HUMAN
          ? requesterWorker.humanUserId
          : (requesterWorker?.personalAgentUserId ?? null);
      if (!boundUserId) {
        // 普通 AI 机器人需求方没有绑定用户，默认不发飞书；
        // 仅自动验收/自动回复失败等升级场景回退通知负责人，且不能标成需求方。
        if (options?.fallbackToRequesterOwner && requesterWorker) {
          const openId = await this.workersService.ownerOpenId(requesterWorker);
          if (openId) {
            return this.sendCard(
              task,
              {
                openId,
                ownerName: requesterWorker.ownerName ?? requesterWorker.name,
              },
              kind,
              title,
              description,
              '负责人',
            );
          }
        }
        return { sent: false };
      }
      const user = await this.users.findOne({
        where: { id: boundUserId },
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
      return { sent: false };
    }
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

  /**
   * 新任务首次分配到真人执行机器人时，通知绑定的真实用户前往工作台处理。
   * 非真人机器人、未绑定用户或缺少飞书 openId 时静默跳过。
   */
  async notifyTaskHumanAssignee(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    if (!task.agentId) return { sent: false };
    const worker = await this.workers.findOne({
      where: { id: task.agentId },
      select: { id: true, name: true, humanUserId: true, runtime: true },
    });
    if (worker?.runtime !== WorkerRuntime.HUMAN || !worker.humanUserId) {
      return { sent: false };
    }
    const user = await this.users.findOne({
      where: { id: worker.humanUserId },
      select: { id: true, name: true, feishuOpenId: true },
    });
    if (!user?.feishuOpenId) return { sent: false };
    return this.sendCard(
      task,
      { openId: user.feishuOpenId, ownerName: user.name },
      kind,
      title,
      description,
      '执行人',
      { workbench: true, actionLabel: '打开工作台' },
    );
  }

  /** 通知当前执行机器人配置的负责人（不按调度机器人优先）。 */
  async notifyTaskAgentOwner(
    task: Task,
    kind: TaskNotifyKind,
    title: string,
    description: string,
  ): Promise<TaskNotifyResult> {
    if (!task.agentId) return { sent: false };
    const worker = await this.workers.findOne({ where: { id: task.agentId } });
    if (!worker) return { sent: false };
    const openId = await this.workersService.ownerOpenId(worker);
    if (!openId) return { sent: false };
    return this.sendCard(
      task,
      { openId, ownerName: worker.ownerName ?? worker.name },
      kind,
      title,
      description,
      '负责人',
    );
  }

  /** 需求方用户 id：当前任务创建人优先，子任务回退根任务创建人 */
  async resolveRequesterUserId(task: Task): Promise<number | null> {
    if (task.requesterType) {
      return task.requesterType === 'user' ? task.requesterId : null;
    }
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
    receiverLabel: '负责人' | '需求方' | '执行人',
    options?: { workbench?: boolean; actionLabel?: string },
  ): Promise<TaskNotifyResult> {
    const template = kind === 'accept' ? 'green' : 'orange';
    const taskUrl =
      options?.workbench || kind === 'accept'
        ? `${this.appUrl}/workbench/tasks/${task.id}`
        : `${this.appUrl}/tasks/${task.id}`;

    // 部分调用方只查了任务的部分字段（如对账兜底只取 id/code/title），
    // 缺状态时不要拼出 "undefined-undefined"。
    const statusLabel =
      [task.status, task.subStatus].filter(Boolean).join('-') || '未知';
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
                text: {
                  tag: 'plain_text',
                  content: options?.actionLabel ?? '打开任务详情',
                },
                type: 'primary',
                url: taskUrl,
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

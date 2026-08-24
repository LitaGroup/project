import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Project } from '../projects/project.entity';
import { Task } from '../tasks/task.entity';

/** 任务运行的通知上下文（开始/结束共用） */
export interface TaskRunContext {
  projectId: number;
  taskId: number;
  /** 检查编号（code），用于群里识别脚本 */
  checkCode: string;
}

/** 发送 webhook 所需的运行结果快照 */
export interface TaskRunResult extends TaskRunContext {
  status: 'success' | 'fail' | 'error';
  success: number;
  fail: number;
  skip: number;
  message: string | null;
}

@Injectable()
export class NotifyService {
  private readonly logger = new Logger(NotifyService.name);
  /** 全局兜底 webhook（FEISHU_WEBHOOK_URL），项目未配置时使用（调试用） */
  private readonly fallbackWebhook: string | null;

  constructor(
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    config: ConfigService,
  ) {
    this.fallbackWebhook = config.get<string>('FEISHU_WEBHOOK_URL') || null;
  }

  /**
   * 任务触发的运行开始前，向项目飞书群推送一条开始记录（含超时时间）。
   * 发送失败只记日志，不影响运行。
   */
  async notifyTaskRunStart(
    context: TaskRunContext,
    timeoutSeconds: number,
  ): Promise<void> {
    await this.send(context, ({ project, task }) =>
      [
        `${task?.title ?? `#${context.taskId}`}任务开始执行，超时时间 ${timeoutSeconds} 秒`,
        `项目：${project?.name ?? `#${context.projectId}`}（检查：${context.checkCode}）`,
      ].join('\n'),
    );
  }

  /**
   * 任务触发的运行结束后，向项目飞书群推送结果（成功/失败/异常/超时都推）。
   * 发送失败只记日志，不影响运行结果。
   */
  async notifyTaskRun(result: TaskRunResult): Promise<void> {
    await this.send(result, ({ project, task }) =>
      [
        `定时任务执行结果：${task?.title ?? `#${result.taskId}`}`,
        `项目：${project?.name ?? `#${result.projectId}`}（检查：${result.checkCode}）`,
        `状态：${result.status === 'success' ? '成功' : '失败'}`,
        `进度：成功 ${result.success} 条，失败 ${result.fail} 条，跳过 ${result.skip} 条`,
        `描述：${result.message || '（无）'}`,
      ].join('\n'),
    );
  }

  /**
   * 公共发送：webhook 取项目 feishuWebhook，未配置回退 FEISHU_WEBHOOK_URL；都为空则跳过。
   */
  private async send(
    context: TaskRunContext,
    buildText: (refs: {
      project: Project | null;
      task: Pick<Task, 'title'> | null;
    }) => string,
  ): Promise<void> {
    try {
      const project = await this.projects.findOne({
        where: { id: context.projectId },
      });
      const webhook = project?.feishuWebhook || this.fallbackWebhook;
      if (!webhook) return;
      const task = await this.tasks.findOne({
        where: { id: context.taskId },
        select: { id: true, title: true },
      });
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msg_type: 'text',
          content: { text: buildText({ project, task }) },
        }),
      });
      // 飞书 webhook 业务失败也可能返回 200（body 带非 0 code / StatusCode），需看响应体
      const body = (await res.json().catch(() => null)) as {
        code?: number;
        StatusCode?: number;
        msg?: string;
        StatusMessage?: string;
      } | null;
      const code = body?.code ?? body?.StatusCode ?? (res.ok ? 0 : -1);
      if (!res.ok || code !== 0) {
        this.logger.warn(
          `飞书 webhook 推送失败（HTTP ${res.status}, code ${code}: ${body?.msg ?? body?.StatusMessage ?? '-'}）: task=${context.taskId}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `飞书 webhook 推送异常: ${(e as Error).message}（task=${context.taskId}）`,
      );
    }
  }
}

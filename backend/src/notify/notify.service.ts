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
  /** 脚本相对路径（"开始执行"通知展示用） */
  scriptPath?: string;
}

/** 发送 webhook 所需的运行结果快照 */
export interface TaskRunResult extends TaskRunContext {
  status: 'success' | 'fail' | 'error';
  /** 触发方式（卡片第一行展示"手动 / 计划时间"） */
  source: 'schedule' | 'manual';
  /** 运行开始时间（计划时间按它格式化） */
  startedAt: Date;
  total: number;
  success: number;
  fail: number;
  skip: number;
  message: string | null;
}

/** 飞书群机器人 hook 地址前缀，项目配置只存 secret，发送时拼接 */
const FEISHU_HOOK_PREFIX = 'https://open.feishu.cn/open-apis/bot/v2/hook/';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 计划时间格式：MMdd HH:mm:ss（本地时区） */
function formatPlannedAt(d: Date): string {
  return `${pad2(d.getMonth() + 1)}${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
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
   * 任务触发的运行开始前，向项目飞书群推送"开始执行"卡片：
   * [执行]（蓝色）任务名 - 触发方式（手动 / 计划时间）+ 项目 + 脚本。
   * 发送失败只记日志，不影响运行。
   */
  async notifyTaskRunStart(
    context: TaskRunContext,
    source: 'schedule' | 'manual',
  ): Promise<void> {
    await this.send(context, ({ project, task }) => {
      const trigger =
        source === 'schedule'
          ? `计划时间：${formatPlannedAt(new Date())}`
          : '手动';
      return {
        msg_type: 'interactive',
        card: {
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: [
                  `**<font color='blue'>[执行]</font>** ${task?.title ?? `#${context.taskId}`} - ${trigger}`,
                  `**项目**：${project?.name ?? `#${context.projectId}`} 项目`,
                  `**脚本**：${context.scriptPath ?? context.checkCode} 脚本`,
                ].join('\n'),
              },
            },
          ],
        },
      };
    });
  }

  /**
   * 任务触发的运行结束后，向项目飞书群推送结果卡片（成功/失败/异常/超时都推）：
   * [成功]（绿色）/ [失败]（红色）任务名 - 触发方式 + 项目 + 脚本 + 详情计数（失败数 0 绿 / >0 红）+ 描述。
   * 发送失败只记日志，不影响运行结果。
   */
  async notifyTaskRun(result: TaskRunResult): Promise<void> {
    await this.send(result, ({ project, task }) => {
      const ok = result.status === 'success';
      const trigger =
        result.source === 'schedule'
          ? `计划时间：${formatPlannedAt(result.startedAt)}`
          : '手动';
      return {
        msg_type: 'interactive',
        card: {
          elements: [
            {
              tag: 'div',
              text: {
                tag: 'lark_md',
                content: [
                  `**<font color='${ok ? 'green' : 'red'}'>[${ok ? '成功' : '失败'}]</font>** ${task?.title ?? `#${result.taskId}`} - ${trigger}`,
                  `**项目**：${project?.name ?? `#${result.projectId}`} 项目`,
                  `**脚本**：${result.scriptPath ?? result.checkCode} 脚本`,
                  `**详情**：共计**${result.total}**条，成功**${result.success}**条，失败**<font color='${result.fail > 0 ? 'red' : 'green'}'>${result.fail}</font>**条，跳过**${result.skip}**条`,
                  `**描述**：${ok ? '执行成功' : result.message || '（无）'}`,
                ].join('\n'),
              },
            },
          ],
        },
      };
    });
  }

  /**
   * 公共发送：webhook 取项目 feishuWebhook（secret，发送时拼接完整 hook 地址），
   * 未配置回退 FEISHU_WEBHOOK_URL；都为空则跳过。
   */
  private async send(
    context: TaskRunContext,
    buildPayload: (refs: {
      project: Project | null;
      task: Pick<Task, 'title'> | null;
    }) => Record<string, unknown>,
  ): Promise<void> {
    try {
      const project = await this.projects.findOne({
        where: { id: context.projectId },
      });
      // 项目配置的是 secret，拼接完整 hook 地址（历史数据若为完整 URL 则直接用）；兜底走环境变量
      const secret = project?.feishuWebhook;
      const webhook = secret
        ? secret.startsWith('http')
          ? secret
          : FEISHU_HOOK_PREFIX + secret
        : this.fallbackWebhook;
      if (!webhook) return;
      const task = await this.tasks.findOne({
        where: { id: context.taskId },
        select: { id: true, title: true },
      });
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload({ project, task })),
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

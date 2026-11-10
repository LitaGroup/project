import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketsService, type TicketView } from '../tickets/tickets.service';
import { FeishuBotApprovalCard } from './feishu-bot-approval-card.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import {
  FeishuBotIdentityService,
  type FeishuSenderId,
} from './feishu-bot-identity.service';

/** 卡片动作返回给飞书的轻量提示 */
interface CardToast {
  toast: { type: 'success' | 'error' | 'info' | 'warning'; content: string };
}

/**
 * 审批任务飞书卡片动作：
 * - 只处理 value.k === 'approval' 且动作类型为 approve 的按钮（驳回走页面必填反馈）；
 * - 操作者按飞书身份映射为平台用户后复用工单审批（权限与网页一致）；
 * - 处理后回写卡片状态并更新卡片内容，重复点击返回已处理提示。
 */
@Injectable()
export class FeishuBotApprovalService {
  private readonly logger = new Logger(FeishuBotApprovalService.name);

  constructor(
    @InjectRepository(FeishuBotApprovalCard)
    private readonly cards: Repository<FeishuBotApprovalCard>,
    private readonly identities: FeishuBotIdentityService,
    private readonly client: FeishuBotClientService,
    private readonly tickets: TicketsService,
  ) {}

  /** 卡片动作入口；非审批动作返回 null 交由其它处理器处理 */
  async handleCardAction(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    value: Record<string, unknown>,
    operator: FeishuSenderId,
  ): Promise<CardToast | null> {
    if (value.k !== 'approval') return null;
    if (value.a !== 'approve') {
      return { toast: { type: 'info', content: '请打开工单链接处理该审批' } };
    }
    const taskId = Number(value.t);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      return { toast: { type: 'error', content: '卡片参数无效' } };
    }
    const user = operator.openId
      ? await this.identities.resolve(row, operator)
      : null;
    if (!user) {
      return {
        toast: {
          type: 'error',
          content: '未识别平台账号，无法直接审批；请打开工单链接处理',
        },
      };
    }
    const card = await this.cards.findOne({
      where: { taskId },
      order: { id: 'DESC' },
    });
    if (card && card.state !== 'pending') {
      return {
        toast: { type: 'info', content: '该审批已处理过，请刷新工单查看' },
      };
    }
    let view: TicketView;
    try {
      view = await this.tickets.approveTaskApproval(taskId, user);
    } catch (error) {
      const message = (error as Error).message || '审批失败';
      return { toast: { type: 'error', content: message.slice(0, 120) } };
    }
    if (card) {
      await this.cards
        .update(
          { id: card.id },
          {
            state: 'approved',
            actedById: user.id,
            actedByName: user.name,
            actedAt: new Date(),
          },
        )
        .catch(() => {});
      await this.updateCard(row, secrets, card, view, user.name).catch(
        (error: Error) =>
          this.logger.warn(`审批卡片状态更新失败：${error.message}`),
      );
    }
    return { toast: { type: 'success', content: '已通过' } };
  }

  /** 审批完成后把原卡片替换为只读结果卡片 */
  private async updateCard(
    row: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    card: FeishuBotApprovalCard,
    view: TicketView,
    operatorName: string,
  ): Promise<void> {
    if (!card.messageId) return;
    const ticketUrl = `${this.client.appUrl}/tickets/${view.id}`;
    await this.client.updateCard(row.id, secrets, card.messageId, {
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: `审批已通过：${view.code} ${view.title}`.slice(0, 80),
        },
        template: 'green',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content: [
              `**工单**：[${view.code} ${view.title}](${ticketUrl})`,
              `**操作人**：${operatorName}`,
              `**时间**：${new Date().toLocaleString('zh-CN', {
                timeZone: 'Asia/Shanghai',
              })}`,
              '',
              '该审批已通过，可在工单中查看最新流程进度。',
            ].join('\n'),
          },
        },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看工单' },
              type: 'default',
              url: ticketUrl,
            },
          ],
        },
      ],
    });
  }
}

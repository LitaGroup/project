import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TicketsService } from '../tickets/tickets.service';
import { FeishuBotApprovalCard } from './feishu-bot-approval-card.entity';
import type { FeishuBotConfig } from './feishu-bot-config.entity';
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
 * - 卡片回写统一由工单运行时在审批完成后触发（网页/卡片/API 同一入口）；
 *   重复点击按卡片登记状态返回已处理提示。
 */
@Injectable()
export class FeishuBotApprovalService {
  constructor(
    @InjectRepository(FeishuBotApprovalCard)
    private readonly cards: Repository<FeishuBotApprovalCard>,
    private readonly identities: FeishuBotIdentityService,
    private readonly tickets: TicketsService,
  ) {}

  /** 卡片动作入口；非审批动作返回 null 交由其它处理器处理 */
  async handleCardAction(
    row: FeishuBotConfig,
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
    try {
      await this.tickets.approveTaskApproval(taskId, user);
    } catch (error) {
      const message = (error as Error).message || '审批失败';
      return { toast: { type: 'error', content: message.slice(0, 120) } };
    }
    // 卡片状态与内容由工单运行时统一回写（网页审批同样覆盖）
    return { toast: { type: 'success', content: '已通过' } };
  }
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 审批卡片状态：pending=待处理 / approved=已通过 / rejected=已驳回 */
export type FeishuBotApprovalCardState = 'pending' | 'approved' | 'rejected';

/**
 * 审批任务飞书卡片登记：发送时落库 messageId，
 * 卡片「通过」回调按任务定位并回写状态，同时用于卡片状态更新。
 */
@Entity('feishu_bot_approval_cards')
@Index('IDX_feishu_bot_approval_cards_task', ['taskId'])
export class FeishuBotApprovalCard {
  @PrimaryGeneratedColumn()
  id: number;

  /** 发送该卡片的飞书配置（平台官方机器人） */
  @Column({ type: 'int' })
  configId: number;

  /** 关联工单（tickets.id） */
  @Column({ type: 'int' })
  ticketId: number;

  /** 关联审批任务（tasks.id） */
  @Column({ type: 'int' })
  taskId: number;

  /** 卡片消息 id（open_message_id） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  messageId: string | null;

  /** pending / approved / rejected */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  state: FeishuBotApprovalCardState;

  /** 操作人（users.id）与姓名快照 */
  @Column({ type: 'int', nullable: true })
  actedById: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  actedByName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  actedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

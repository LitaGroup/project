import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 群记录类型：入站消息 / 机器人回复 / 被拉入群 / 被移出群 */
export type FeishuBotGroupRecordKind =
  'message' | 'reply' | 'bot_added' | 'bot_removed';

/**
 * 入站消息的处理结果：
 * - replied：已回复；
 * - silent：智能模式下 AI 判定不回复；
 * - not_mentioned：仅 @ 策略下未被 @，不回复；
 * - record_only：仅记录策略（或机器人已移出等）不回复；
 * - busy：同群上一轮仍在处理，本次跳过；
 * - error：处理失败。
 */
export type FeishuBotGroupRecordDecision =
  'replied' | 'silent' | 'not_mentioned' | 'record_only' | 'busy' | 'error';

/** 群记录内容截断长度（避免长文占用存储） */
export const FEISHU_BOT_GROUP_RECORD_CONTENT_LIMIT = 4000;

/**
 * 外部群时间线记录：消息、回复、机器人进/出群统一归档，
 * 供管理页「策略 - 记录」查看反馈记录与群会话。
 */
@Entity('feishu_bot_group_records')
@Index('IDX_feishu_bot_group_records_group', ['groupId', 'id'])
@Index('IDX_feishu_bot_group_records_configId', ['configId'])
@Index('IDX_feishu_bot_group_records_createdAt', ['createdAt'])
export class FeishuBotGroupRecord {
  @PrimaryGeneratedColumn()
  id: number;

  /** 所属飞书应用配置 */
  @Column({ type: 'int' })
  configId: number;

  /** 群（feishu_bot_groups.id） */
  @Column({ type: 'int' })
  groupId: number;

  /** message / reply / bot_added / bot_removed */
  @Column({ type: 'varchar', length: 20 })
  kind: FeishuBotGroupRecordKind;

  /** 飞书消息 id（进/出群事件为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  messageId: string | null;

  /** 发送者/操作者飞书 open_id */
  @Column({ type: 'varchar', length: 100, nullable: true })
  senderOpenId: string | null;

  /** 发送者/操作者展示名（解析出平台用户用平台姓名） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  senderName: string | null;

  /** 解析出的平台用户（未识别为空） */
  @Column({ type: 'int', nullable: true })
  senderUserId: number | null;

  /** 飞书消息类型（text/post 等；进/出群事件为空） */
  @Column({ type: 'varchar', length: 30, nullable: true })
  messageType: string | null;

  /** 文本内容（截断后存储） */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** 入站消息处理结果；回复/进群/出群记录为空 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  decision: FeishuBotGroupRecordDecision | null;

  /** 处理失败原因 */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

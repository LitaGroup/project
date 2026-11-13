import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 发送方身份类型：机器人令牌 / 平台管理员（含公共 Agent） */
export type FeishuOfficialMessageSenderType = 'worker' | 'user';

/** 收件人类型：平台用户 / 飞书 open_id / 群 chat_id */
export type FeishuOfficialMessageTargetType = 'user' | 'open_id' | 'chat';

/** 发送结果 */
export type FeishuOfficialMessageStatus = 'success' | 'failed';

/**
 * 平台名义飞书消息审计：凡以平台官方机器人身份发出的消息都落一条，
 * 记录「谁、在什么时候、给谁、发了什么、是否成功」，便于追溯。
 * content 为大字段，列表查询不得带出（用 contentLength 展示长度）。
 */
@Entity('feishu_bot_official_messages')
@Index('IDX_feishu_bot_official_messages_createdAt', ['createdAt'])
@Index('IDX_feishu_bot_official_messages_sender', ['senderType', 'senderId'])
export class FeishuBotOfficialMessage {
  @PrimaryGeneratedColumn()
  id: number;

  /** 发送方类型：worker=机器人令牌 / user=平台用户 */
  @Column({ type: 'varchar', length: 10 })
  senderType: FeishuOfficialMessageSenderType;

  /** 发送方 ID（workers.id 或 users.id；公共 Agent 为虚拟用户 ID） */
  @Column({ type: 'int' })
  senderId: number;

  /** 发送方姓名快照 */
  @Column({ type: 'varchar', length: 120 })
  senderName: string;

  /** 收件人类型 */
  @Column({ type: 'varchar', length: 10 })
  targetType: FeishuOfficialMessageTargetType;

  /** 实际发送用的 receive_id（open_id 或 chat_id） */
  @Column({ type: 'varchar', length: 100 })
  targetId: string;

  /** 收件人平台用户 ID（targetType=user 时有值） */
  @Column({ type: 'int', nullable: true })
  targetUserId: number | null;

  /** 收件人展示名快照（用户姓名等） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  targetName: string | null;

  /** 卡片标题（可空） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title: string | null;

  /** Markdown 正文（大字段，列表查询必须排除） */
  @Column({ type: 'text' })
  content: string;

  /** 正文长度（列表展示用） */
  @Column({ type: 'int', default: 0 })
  contentLength: number;

  /** 话题内回复的目标消息 ID（可空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  replyToMessageId: string | null;

  /** 飞书返回的消息 ID 列表（超长正文分片时多条） */
  @Column({ type: 'simple-json', nullable: true })
  messageIds: string[] | null;

  /** success / failed */
  @Column({ type: 'varchar', length: 10, default: 'success' })
  status: FeishuOfficialMessageStatus;

  /** 失败原因 */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

/** 审计列表视图（不含正文大字段） */
export interface FeishuOfficialMessageView {
  id: number;
  senderType: FeishuOfficialMessageSenderType;
  senderId: number;
  senderName: string;
  targetType: FeishuOfficialMessageTargetType;
  targetId: string;
  targetUserId: number | null;
  targetName: string | null;
  title: string | null;
  contentLength: number;
  replyToMessageId: string | null;
  messageIds: string[] | null;
  status: FeishuOfficialMessageStatus;
  error: string | null;
  createdAt: string;
}

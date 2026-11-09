import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 提问卡片状态 */
export type FeishuBotCardState =
  'pending' | 'answered' | 'rejected' | 'expired';

/** 卡片上单个问题的描述（构建选项按钮与文本作答映射用） */
export interface FeishuBotCardQuestion {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiple?: boolean;
  custom?: boolean;
}

/**
 * 飞书提问卡片登记：Agent 提问 → 飞书互动卡片。
 * 卡片回调携带本表 id，按行校验操作者/状态后答复 opencode question。
 */
@Entity('feishu_bot_cards')
@Index('IDX_feishu_bot_cards_question', ['scope', 'questionId'])
@Index('IDX_feishu_bot_cards_userId', ['userId'])
export class FeishuBotCard {
  @PrimaryGeneratedColumn()
  id: number;

  /** 所属飞书配置 */
  @Column({ type: 'int' })
  configId: number;

  /** 发起会话的平台用户 */
  @Column({ type: 'int' })
  userId: number;

  /** 会话目标机器人（official 时为该用户个人 AGENT） */
  @Column({ type: 'int' })
  workerId: number;

  /** 会话范围（feishu:p2p:{chatId} 等） */
  @Column({ type: 'varchar', length: 120 })
  scope: string;

  /** 飞书聊天 id（卡片回复定位用） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  chatId: string | null;

  /** 卡片消息 id（open_message_id，可空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  messageId: string | null;

  /** opencode question id */
  @Column({ type: 'varchar', length: 100 })
  questionId: string;

  /** pending / answered / rejected / expired */
  @Column({ type: 'varchar', length: 20, default: 'pending' })
  state: FeishuBotCardState;

  /** 卡片问题快照（选项/多选/自由输入） */
  @Column({ type: 'simple-json' })
  questions: FeishuBotCardQuestion[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

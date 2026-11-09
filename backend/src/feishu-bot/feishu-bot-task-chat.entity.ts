import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 任务群状态 */
export type FeishuBotTaskChatState =
  'creating' | 'active' | 'error' | 'destroyed';

/** AI 参与方位于需求侧还是执行侧 */
export type FeishuBotTaskChatAiSide = 'requester' | 'agent';

/**
 * 任务群绑定：任务 = 飞书群。
 * 仅第一期「一个真人 + 一个 AI 机器人」的根任务自动建群；
 * 平台官方机器人建群并代理任务 AI；任务终态 24 小时后自动解散。
 */
@Entity('feishu_bot_task_chats')
@Index('IDX_feishu_bot_task_chats_chatId', ['chatId'])
@Index('IDX_feishu_bot_task_chats_state', ['state'])
export class FeishuBotTaskChat {
  @PrimaryGeneratedColumn()
  id: number;

  /** 任务（tasks.id，根任务，唯一） */
  @Column({ type: 'int', unique: true })
  taskId: number;

  /** 建群用的官方机器人配置 */
  @Column({ type: 'int' })
  officialConfigId: number;

  /** 飞书群 chat_id（创建成功后写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  chatId: string | null;

  /** creating / active / error / destroyed */
  @Column({ type: 'varchar', length: 20, default: 'creating' })
  state: FeishuBotTaskChatState;

  /** AI 位于需求侧（requester）还是执行侧（agent） */
  @Column({ type: 'varchar', length: 20 })
  aiSide: FeishuBotTaskChatAiSide;

  /** 群内真人（需求方用户或真人执行人） */
  @Column({ type: 'int' })
  humanUserId: number;

  @Column({ type: 'varchar', length: 120 })
  humanName: string;

  /** AI 机器人（workers.id） */
  @Column({ type: 'int' })
  aiWorkerId: number;

  @Column({ type: 'varchar', length: 120 })
  aiWorkerName: string;

  /** 任务编号快照（群名/卡片展示） */
  @Column({ type: 'varchar', length: 40 })
  taskCode: string;

  /** 任务标题快照 */
  @Column({ type: 'varchar', length: 220 })
  taskTitle: string;

  /** 任务终态时间（进入终态时写入） */
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** 是否已发送任务完成卡片 */
  @Column({ default: false })
  finishedNotified: boolean;

  /** 解散时间（终态 + 24h；到点由定时任务解散） */
  @Column({ type: 'timestamptz', nullable: true })
  destroyAfter: Date | null;

  /** 建群重试次数 */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** 最近一次建群/解散错误 */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

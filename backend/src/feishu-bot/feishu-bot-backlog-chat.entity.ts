import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Backlog 沟通群状态 */
export type FeishuBotBacklogChatState =
  'creating' | 'active' | 'error' | 'destroyed';

/**
 * 迭代项（Backlog）沟通群：backlog 创建后建群。
 * 群内含产品/业务/项目/技术等成员及绑定飞书的机器人；
 * backlog 完成/取消后保留 7 天自动解散。
 */
@Entity('feishu_bot_backlog_chats')
@Index('IDX_feishu_bot_backlog_chats_backlogId', ['backlogId'])
@Index('IDX_feishu_bot_backlog_chats_chatId', ['chatId'])
@Index('IDX_feishu_bot_backlog_chats_state', ['state'])
export class FeishuBotBacklogChat {
  @PrimaryGeneratedColumn()
  id: number;

  /** 迭代项（backlogs.id，唯一） */
  @Column({ type: 'int', unique: true })
  backlogId: number;

  /** 建群用的官方机器人配置 */
  @Column({ type: 'int' })
  officialConfigId: number;

  /** 飞书群 chat_id（创建成功后写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  chatId: string | null;

  /** creating / active / error / destroyed */
  @Column({ type: 'varchar', length: 20, default: 'creating' })
  state: FeishuBotBacklogChatState;

  /** 群名快照 */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** backlog 标题快照 */
  @Column({ type: 'varchar', length: 200 })
  backlogTitle: string;

  /** 建群时成功解析的群成员（users.id 快照） */
  @Column({ type: 'simple-json', default: '[]' })
  memberUserIds: number[];

  /** 建群时成功解析的群成员姓名快照 */
  @Column({ type: 'simple-json', default: '[]' })
  memberNames: string[];

  /** 一并拉入的机器人应用 App ID（可空） */
  @Column({ type: 'simple-json', default: '[]' })
  botIds: string[];

  /** 最近一次已通知状态（避免重复推送） */
  @Column({ type: 'varchar', length: 40, nullable: true })
  lastStatus: string | null;

  /** backlog 终态（完成/取消）时间 */
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** 是否已发送终态卡片 */
  @Column({ default: false })
  finishedNotified: boolean;

  /** 解散时间（终态 + 7 天） */
  @Column({ type: 'timestamptz', nullable: true })
  destroyAfter: Date | null;

  /** 建群重试次数 */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** 最近一次建群/通知/解散错误 */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

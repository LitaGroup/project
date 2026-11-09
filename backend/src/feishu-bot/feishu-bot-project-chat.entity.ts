import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 项目沟通群状态 */
export type FeishuBotProjectChatState =
  'creating' | 'active' | 'error' | 'destroyed';

/**
 * 项目交付沟通群：项目详情「安排项目机器人」创建任务后建群。
 * 群内包含项目前端/后端/测试/产品等相关方；根任务与直接子任务状态变化实时推送，
 * 根任务进入终态后保留 7 天自动解散。
 */
@Entity('feishu_bot_project_chats')
@Index('IDX_feishu_bot_project_chats_projectId', ['projectId'])
@Index('IDX_feishu_bot_project_chats_chatId', ['chatId'])
@Index('IDX_feishu_bot_project_chats_state', ['state'])
export class FeishuBotProjectChat {
  @PrimaryGeneratedColumn()
  id: number;

  /** 项目（projects.id） */
  @Column({ type: 'int' })
  projectId: number;

  /** 项目交付根任务（tasks.id，唯一） */
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
  state: FeishuBotProjectChatState;

  /** 群名快照 */
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** 项目名称快照 */
  @Column({ type: 'varchar', length: 200 })
  projectName: string;

  /** 建群时成功解析的群成员（users.id 快照） */
  @Column({ type: 'simple-json', default: '[]' })
  memberUserIds: number[];

  /** 建群时成功解析的群成员姓名快照 */
  @Column({ type: 'simple-json', default: '[]' })
  memberNames: string[];

  /** 一并拉入的机器人应用 App ID（可空） */
  @Column({ type: 'simple-json', default: '[]' })
  botIds: string[];

  /** 各任务最近一次已通知状态：taskId -> "主状态-子状态" */
  @Column({ type: 'simple-json', default: '{}' })
  lastStatuses: Record<string, string>;

  /** 根任务终态时间 */
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** 是否已发送根任务终态卡片 */
  @Column({ default: false })
  finishedNotified: boolean;

  /** 解散时间（根任务终态 + 7 天） */
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

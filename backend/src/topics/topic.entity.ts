import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import {
  TopicAuthorType,
  TopicStatus,
  TopicSubjectType,
  TopicType,
} from '../common/enums';

/** 话题中被 @ 的机器人快照 */
export interface TopicMention {
  type: 'worker';
  id: number;
  name: string;
}

/** 问答话题的协议数据 */
export interface TopicQuestionPayload {
  questionId?: string;
  questions: Array<{
    header: string;
    question: string;
    options?: Array<{ label: string; description?: string }>;
    multiple?: boolean;
    custom?: boolean;
    fieldKey?: string;
  }>;
  answers?: string[][];
  answeredBy?: { type: string; id: number | null; name: string };
  answeredAt?: string;
  rejected?: boolean;
}

/**
 * 话题（主帖）：主体下的一条讨论，默认跟随主话题，也可单独新开。
 * - 主话题 isDefault=true，用户默认消息作为其回复；
 * - 问答话题 type=question，metadata 存问题与答案；
 * - 系统话题 type=system，如「验收不通过」；
 * - 标签包含固定「澄清 / 建议」与自定义文本；
 * - 无物理外键，主体删除时由应用层清理。
 */
@Entity('discussion_topics')
@Index('IDX_discussion_topics_subject', [
  'subjectType',
  'subjectId',
  'lastReplyAt',
])
@Index('IDX_discussion_topics_status', ['status'])
@Index('IDX_discussion_topics_type', ['type'])
@Index('IDX_discussion_topics_isDefault', ['subjectType', 'subjectId'], {
  unique: true,
  where: '"isDefault" = true AND "deletedAt" IS NULL',
})
export class Topic {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  subjectType: TopicSubjectType;

  /** 主体 id：数字主体存字符串，知识文章存知识节点 id */
  @Column({ type: 'varchar', length: 120 })
  subjectId: string;

  /** 标题：内容/系统帖可空，问答帖取问题 header 或首行 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  title: string | null;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'varchar', length: 20, default: TopicType.CONTENT })
  type: TopicType;

  @Column({ type: 'varchar', length: 20, default: TopicStatus.OPEN })
  status: TopicStatus;

  /** 固定标签 + 自定义标签 */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  tags: string[];

  /** 问答是否阻塞任务/工单状态（仅 task/ticket 使用） */
  @Column({ type: 'boolean', default: false })
  blocking: boolean;

  /** 主体默认主话题：默认发消息进这里，点「新开话题」才创建非默认话题 */
  @Column({ type: 'boolean', default: false })
  isDefault: boolean;

  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  @Column({ type: 'boolean', default: false })
  locked: boolean;

  @Column({ type: 'varchar', length: 20, default: TopicAuthorType.USER })
  authorType: TopicAuthorType;

  @Column({ type: 'int', nullable: true })
  authorId: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  authorName: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  authorAvatarUrl: string | null;

  @Column({ type: 'jsonb', nullable: true })
  images: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  mentions: TopicMention[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: TopicQuestionPayload | Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  replyCount: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastReplyAt: Date | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  lastReplyByName: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { TopicAuthorType, TopicReplyStatus } from '../common/enums';
import type { TopicMention } from './topic.entity';

/**
 * 话题回复：主话题的日常消息、话题内讨论、机器人回复、问答答案都以回复承载。
 * sourceMessageId 用于任务聊天镜像幂等：同一任务消息只落一条话题回复。
 */
@Entity('discussion_replies')
@Index('IDX_discussion_replies_topic', ['topicId', 'id'])
@Index('UQ_discussion_replies_source', ['topicId', 'sourceMessageId'], {
  unique: true,
  where: '"sourceMessageId" IS NOT NULL',
})
export class TopicReply {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  topicId: number;

  @Column({ type: 'text', default: '' })
  content: string;

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
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: TopicReplyStatus.COMPLETE })
  status: TopicReplyStatus;

  /** 任务聊天消息 id（镜像幂等） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  sourceMessageId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

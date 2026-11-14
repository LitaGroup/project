import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 话题个人通知：@机器人、被回复等站内提醒 */
@Entity('discussion_notifications')
@Index('IDX_discussion_notifications_user', ['userId', 'readAt', 'id'])
@Index('IDX_discussion_notifications_topic', ['topicId'])
export class TopicNotification {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  userId: number;

  /** mention / reply / question / system */
  @Column({ type: 'varchar', length: 20 })
  type: string;

  @Column({ type: 'int' })
  topicId: number;

  @Column({ type: 'int', nullable: true })
  replyId: number | null;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

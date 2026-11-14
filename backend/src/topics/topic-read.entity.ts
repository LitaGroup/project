import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 话题已读：按用户记录最后读到的回复，用于未读计数 */
@Entity('discussion_reads')
@Index('UQ_discussion_reads_topic_user', ['topicId', 'userId'], {
  unique: true,
})
export class TopicRead {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  topicId: number;

  @Column({ type: 'int' })
  userId: number;

  @Column({ type: 'int', default: 0 })
  lastReadReplyId: number;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 任务话题轮次：保证多个话题同时触发任务时，机器人输出回到正确话题 */
@Entity('discussion_task_turns')
@Index('IDX_discussion_task_turns_task', ['taskId', 'status', 'id'])
@Index('IDX_discussion_task_turns_topic', ['topicId'])
export class TopicTaskTurn {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  taskId: number;

  @Column({ type: 'int' })
  topicId: number;

  /** 触发本轮的回复 id；主帖创建的话题为空 */
  @Column({ type: 'int', nullable: true })
  replyId: number | null;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  status: 'queued' | 'running' | 'done' | 'error' | 'cancelled';

  @Column({ type: 'int', nullable: true })
  actorWorkerId: number | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  actorName: string | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

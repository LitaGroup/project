import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 任务话题上下文：记录任务当前应把机器人输出写回哪个话题。
 * 任务仍只有一个 opencode 会话；本表只做消息归属，不创建额外执行会话。
 */
@Entity('discussion_task_contexts')
@Index('UQ_discussion_task_contexts_task', ['taskId'], { unique: true })
export class TopicTaskContext {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  taskId: number;

  @Column({ type: 'int', nullable: true })
  activeTopicId: number | null;

  /** 最近一次触发机器人回复的话题 title 快照（排查用） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  activeTopicTitle: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

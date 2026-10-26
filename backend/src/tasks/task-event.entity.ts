import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 任务流转/操作事件（append-only，不可编辑删除）。
 * operator 为空表示系统动作（调度机器人/执行回调）。
 */
@Entity('task_events')
@Index(['taskId'])
export class TaskEvent {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  taskId: number;

  /** 事件类型：状态变更 / 操作 / 系统 / 反馈 */
  @Column({ length: 20 })
  type: string;

  @Column({ type: 'text' })
  content: string;

  /** 附加信息（如调度方案 id、会话事件摘要） */
  @Column({ type: 'simple-json', nullable: true })
  meta: Record<string, unknown> | null;

  /** 操作人姓名（系统动作为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  @CreateDateColumn()
  createdAt: Date;
}

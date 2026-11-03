import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 需要父任务机器人处理的子任务事件类型。 */
export type TaskWorkerInboxKind =
  'question' | 'handoff' | 'message' | 'refused' | 'cancelled';

/** pending=待排队；queued=已写入待继续上下文；delivered=已发给父机器人；done/dead=结束 */
export type TaskWorkerInboxStatus =
  'pending' | 'queued' | 'delivered' | 'done' | 'dead';

/**
 * 机器人需求方收件箱：子任务需要父机器人答复、验收或重新分发时持久化事件。
 * 无物理外键，任务删除时由应用层清理。
 */
@Entity('task_worker_inbox')
@Index(['workerId', 'status'])
@Index(['parentTaskId', 'status'])
@Index(['childTaskId', 'status'])
export class TaskWorkerInbox {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  parentTaskId: number;

  @Column({ type: 'int' })
  workerId: number;

  @Column({ type: 'int' })
  childTaskId: number;

  @Column({ type: 'varchar', length: 20 })
  kind: TaskWorkerInboxKind;

  /** 关联的平台提问 id 等；普通子任务事件为空 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  referenceId: string | null;

  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: TaskWorkerInboxStatus;

  /** 已尝试唤醒父机器人的次数；达到阈值后转人工，避免无限循环 */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** 最近一次尝试唤醒/恢复的时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  /** 下次允许重试的时间（退避） */
  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  /** 最近一次恢复失败原因 */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

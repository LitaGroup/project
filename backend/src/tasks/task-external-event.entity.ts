import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 投递状态：
 * - queued=待唤醒（新建或等待任务进入可接收状态）；
 * - delivered=已投递（直投会话或已写入待继续上下文）；
 * - recorded=任务已结束，仅记录不再唤醒；
 * - dead=多次重试仍无法投递，放弃。
 */
export type TaskExternalEventDeliveryStatus =
  'queued' | 'delivered' | 'recorded' | 'dead';

/**
 * 任务外部事件（当前来源为 lita-proxy 线上操作工单状态回调）：
 * 先持久化再唤醒任务会话，进程重启后可继续补投；
 * 同一任务 + 同一工单 + 同一状态只落一条，回调重试天然幂等。
 */
@Entity('task_external_events')
@Index('UQ_task_external_events_ticket_status', [
  'taskId',
  'source',
  'externalTicketId',
  'externalStatus',
])
@Index('IDX_task_external_events_taskId', ['taskId'])
@Index('IDX_task_external_events_delivery', ['deliveryStatus', 'nextRetryAt'])
export class TaskExternalEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /** 关联任务（tasks.id，应用层软引用） */
  @Column({ type: 'int' })
  taskId: number;

  /** 事件来源：当前仅 lita-proxy */
  @Column({ type: 'varchar', length: 30 })
  source: string;

  /** 外部单号（proxy 工单 ID） */
  @Column({ type: 'int' })
  externalTicketId: number;

  /** 事件类型（如 ticket.status_changed） */
  @Column({ type: 'varchar', length: 60 })
  eventType: string;

  /** 外部状态（如 executing/success/failed/rejected/cancelled） */
  @Column({ type: 'varchar', length: 30 })
  externalStatus: string;

  /** 原始回调报文（不含凭据） */
  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 20, default: 'queued' })
  deliveryStatus: TaskExternalEventDeliveryStatus;

  /** 已尝试唤醒次数（退避依据） */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', nullable: true })
  lastAttemptAt: Date | null;

  /** 下次允许重试的时间 */
  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

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

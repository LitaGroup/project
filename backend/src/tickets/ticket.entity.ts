import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 工单责任方类型：人类用户 / 机器人 */
export type TicketAssigneeType = 'user' | 'worker';

/**
 * 工单：独立于任务的业务受理记录，一对一关联一个调度任务。
 * 状态不落库，按关联任务的主/子状态实时推导，避免双状态漂移。
 */
@Entity('tickets')
@Index(['category'])
@Index('IDX_tickets_taskId', ['taskId'], { unique: true })
export class Ticket {
  @PrimaryGeneratedColumn()
  id: number;

  /** 工单编号（WO-0001，按 id 生成） */
  @Column({ length: 30, unique: true })
  code: string;

  /** 工单类型：方案工单 / 技术工单 / 数据工单 / 运维工单 / 需求工单 / BUG反馈 */
  @Column({ type: 'varchar', length: 64 })
  category: string;

  @Column({ length: 200 })
  title: string;

  /** 工单原始描述（Markdown），同时作为任务初始描述 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 创建人（需求方）快照 */
  @Column({ type: 'int' })
  createdById: number;

  @Column({ type: 'varchar', length: 100 })
  createdByName: string;

  /** 责任方（创建时选择，仅作责任归属记录，不参与任务派发） */
  @Column({ type: 'varchar', length: 20 })
  assigneeType: TicketAssigneeType;

  @Column({ type: 'int' })
  assigneeId: number;

  @Column({ type: 'varchar', length: 100 })
  assigneeName: string;

  /** 关联调度任务（tasks.id，无物理外键） */
  @Column({ type: 'int' })
  taskId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

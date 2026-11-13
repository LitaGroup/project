import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 迭代项事件流：append-only，记录 backlog 生命周期内的完整事件。
 * - type：created / status（状态流转）/ moved（移动迭代）/ release-ticket（提测工单）等；
 * - payload：事件明细快照（如 { from, to, remark }）；
 * - operator：操作人姓名快照（系统自动动作为 null）。
 */
@Entity('backlog_events')
@Index('IDX_backlog_events_backlogId', ['backlogId'])
export class BacklogEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /** 迭代项（backlogs.id，应用层引用） */
  @Column({ type: 'int' })
  backlogId: number;

  @Column({ type: 'varchar', length: 30 })
  type: string;

  /** 事件明细（按 type 结构不同） */
  @Column({ type: 'simple-json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

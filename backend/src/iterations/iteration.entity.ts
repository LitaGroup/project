import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { IterationStatus, IterationType } from '../common/enums';

/**
 * 迭代：由 backlog 组成的计划单元，独立于需求池。
 * - T0：常驻快速通道（单例，code 固定为 T0，无起止日期）；
 * - W1：按周迭代，有唯一标识（如 W2026-46）与起止日期。
 * 无物理外键：backlogs.iterationId 为应用层引用。
 */
@Entity('iterations')
@Index('IDX_iterations_type', ['type'])
@Index('IDX_iterations_status', ['status'])
export class Iteration {
  @PrimaryGeneratedColumn()
  id: number;

  /** 唯一标识：T0 固定为 T0；W1 如 W2026-46 */
  @Column({ length: 50, unique: true })
  code: string;

  @Column({ type: 'enum', enum: IterationType, default: IterationType.W1 })
  type: IterationType;

  @Column({ length: 200 })
  name: string;

  /** 开始日期（W1 必填；T0 为空） */
  @Column({ type: 'date', nullable: true })
  startAt: string | null;

  /** 结束日期（W1 必填；T0 为空） */
  @Column({ type: 'date', nullable: true })
  endAt: string | null;

  @Column({
    type: 'enum',
    enum: IterationStatus,
    default: IterationStatus.ACTIVE,
  })
  status: IterationStatus;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

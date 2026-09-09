import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MilestoneAchieved } from '../common/enums';
import { Project } from '../projects/project.entity';

/**
 * 节点：某个时间点需要完成的事项。日期指北京时间当日 23:59:59 前完成。
 * 状态不落库，由 achieved + achievedAt + date 推导（见 common/enums.ts MilestoneStatus）。
 */
@Entity('milestones')
export class Milestone {
  @PrimaryGeneratedColumn()
  id: number;

  /** 应完成日期（YYYY-MM-DD，北京时间当日 23:59:59 前） */
  @Column({ type: 'date' })
  date: string;

  /** 达成标记：no（默认）/yes/cancel；yes 须研发验收后标记 */
  @Column({
    type: 'enum',
    enum: MilestoneAchieved,
    default: MilestoneAchieved.NO,
  })
  achieved: MilestoneAchieved;

  /** 实际达成日期（YYYY-MM-DD）：标记 yes 时自动取北京时间当天；no/cancel 时为 null */
  @Column({ type: 'date', nullable: true })
  achievedAt: string | null;

  /** 内容：该节点要完成的事项 */
  @Column({ type: 'text' })
  content: string;

  /** 备注 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  /** 交付人（可空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  deliverer: string | null;

  /** 验收人（可空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  acceptor: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.milestones, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

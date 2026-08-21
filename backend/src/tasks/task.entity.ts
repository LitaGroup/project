import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Check } from '../checks/check.entity';
import { Project } from '../projects/project.entity';

/** 任务：按 crontab 表达式定时运行一个已登记的检查脚本 */
@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn()
  id: number;

  /** 标题 */
  @Column({ length: 200 })
  title: string;

  /** crontab 表达式（5 段：分 时 日 月 周），如 0/5 * * * *（每 5 分钟） */
  @Column({ length: 100 })
  cron: string;

  // 测试库账号无 REFERENCES 权限，不建物理外键（同 Check，见 AGENTS.md）
  @ManyToOne(() => Project, (project) => project.tasks, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: number;

  /** 使用的检查脚本（登记于 checks 表） */
  @ManyToOne(() => Check, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column()
  checkId: number;

  /** 是否启用（停用的任务不参与调度） */
  @Column({ default: true })
  enabled: boolean;

  /** 最近一次触发时间 */
  @Column({ type: 'datetime', nullable: true })
  lastRunAt: Date | null;

  /** 已运行次数（任务触发累计，含失败） */
  @Column({ default: 0 })
  runCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

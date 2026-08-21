import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Check } from './check.entity';

/** 单条 act/check 记录（脚本输出协议，见 scripts 仓库 AGENTS.md） */
export interface CheckRunItem {
  kind: 'act' | 'check';
  no?: number;
  title?: string;
  status?: 'success' | 'fail' | 'skip';
  expect?: string;
  real?: string;
  message?: string;
  /** 相对 start 的毫秒时间 */
  time?: number;
}

/** 检查的一次脚本运行记录：running 期间实时更新 current/total，结束后落完整结果 */
@Entity('check_runs')
@Index(['checkId'])
export class CheckRun {
  @PrimaryGeneratedColumn()
  id: number;

  /** running=执行中；success=全部通过；fail=有失败项；error=脚本异常（未输出 [done]） */
  @Column({ length: 20, default: 'running' })
  status: 'running' | 'success' | 'fail' | 'error';

  /** 总步数（脚本 [start] 上报） */
  @Column({ type: 'int', nullable: true })
  total: number | null;

  /** 当前步数（运行中实时更新） */
  @Column({ type: 'int', default: 0 })
  current: number;

  @Column({ type: 'int', nullable: true })
  success: number | null;

  @Column({ type: 'int', nullable: true })
  fail: number | null;

  @Column({ type: 'int', nullable: true })
  skip: number | null;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  /** 耗时（毫秒），结束时写入 */
  @Column({ type: 'int', nullable: true })
  durationMs: number | null;

  /** 逐项明细（结束时写入） */
  @Column({ type: 'json', nullable: true })
  items: CheckRunItem[] | null;

  /** 日志行（结束时写入） */
  @Column({ type: 'json', nullable: true })
  logs: string[] | null;

  /** 脚本原始输出行（终端展示用；运行中实时累积，结束时落库） */
  @Column({ type: 'json', nullable: true })
  output: string[] | null;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同 Check，见 AGENTS.md）
  @ManyToOne(() => Check, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'checkId' })
  check: Check;

  @Column()
  checkId: number;

  /** 触发来源任务（tasks 表 id；手动运行为 null）。仅记 id 不建关系，任务删除后运行记录保留 */
  @Column({ type: 'int', nullable: true })
  taskId: number | null;
}

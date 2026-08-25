import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Test } from './test.entity';

/** 单条 act/check 记录（脚本输出协议，与检查相同，见 scripts 仓库 AGENTS.md） */
export interface TestRunItem {
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

/** 测试的一次脚本运行记录：running 期间实时更新 current/total，结束后落完整结果 */
@Entity('test_runs')
@Index(['testId'])
export class TestRun {
  @PrimaryGeneratedColumn()
  id: number;

  /** queued=已入队待 appium-agent 执行；running=执行中；success=全部通过；fail=有失败项；error=脚本异常（未输出 [done]） */
  @Column({ length: 20, default: 'running' })
  status: 'queued' | 'running' | 'success' | 'fail' | 'error';

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
  items: TestRunItem[] | null;

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

  /** 入队时间（APP 测试远程执行时 FIFO 排序用），非 APP 测试为空 */
  @Column({ type: 'datetime', nullable: true })
  queuedAt: Date | null;

  /** 关联的 APP 版本（app_versions.id），非 APP 测试为空 */
  @Column({ type: 'int', nullable: true })
  appVersionId: number | null;

  /** 执行机标识（agent name），APP 测试记录用于区分来源 */
  @Column({ type: 'varchar', length: 100, nullable: true })
  agentName: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同 Test，见 AGENTS.md）
  @ManyToOne(() => Test, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'testId' })
  test: Test;

  @Column()
  testId: number;
}

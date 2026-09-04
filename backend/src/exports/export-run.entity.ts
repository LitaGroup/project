import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Export } from './export.entity';

/** 单条 act/check 记录（脚本输出协议，与检查/测试一致） */
export interface ExportRunItem {
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

/** 脚本 [files] 协议上报的产出文件（file 相对本次运行的输出目录） */
export interface ExportRunFile {
  title: string;
  file: string;
}

/**
 * 导出的一次脚本运行记录：running 期间实时更新 current/total，结束后落完整结果。
 * 产出文件落在 exportWebroot()/{exportId}/{runId}/，经 /export-files/... 访问下载。
 */
@Entity('export_runs')
@Index(['exportId'])
export class ExportRun {
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
  items: ExportRunItem[] | null;

  /** 日志行（结束时写入） */
  @Column({ type: 'json', nullable: true })
  logs: string[] | null;

  /** 脚本原始输出行（终端展示用；运行中实时累积，结束时落库） */
  @Column({ type: 'json', nullable: true })
  output: string[] | null;

  /** 产出文件清单（脚本 [files] 协议上报；file 相对本次运行的输出目录） */
  @Column({ type: 'json', nullable: true })
  files: ExportRunFile[] | null;

  @Column({ type: 'datetime' })
  startedAt: Date;

  @Column({ type: 'datetime', nullable: true })
  finishedAt: Date | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同 Export，见 AGENTS.md）
  @ManyToOne(() => Export, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'exportId' })
  export: Export;

  @Column()
  exportId: number;
}

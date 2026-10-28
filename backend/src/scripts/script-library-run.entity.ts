import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** 脚本库脚本类型：按文件后缀区分（.check.ts / .test.ts / .export.ts） */
export type ScriptLibraryKind = 'check' | 'test' | 'export';

/** 单条 act/check 记录（脚本输出协议，与检查/测试/导出一致） */
export interface ScriptLibraryRunItem {
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

/** 脚本 [files] 协议上报的产物文件（file 相对本次运行的输出目录） */
export interface ScriptLibraryRunFile {
  title: string;
  file: string;
}

/**
 * 脚本库的一次脚本运行记录：脚本无需登记到项目即可直接运行。
 * 产物落在 exportWebroot()/library/{runId}/，经 /export-files/library/... 下载；
 * 脚本后续被删除或路径变更，历史运行记录仍保留。
 */
@Entity('script_library_runs')
@Index(['scriptPath'])
export class ScriptLibraryRun {
  @PrimaryGeneratedColumn()
  id: number;

  /** 脚本位置：相对脚本根目录的路径（如 projects/active/pk/tests/xxx.test.ts） */
  @Column({ length: 500 })
  scriptPath: string;

  /** 脚本类型：check=线上检查 / test=测试 / export=数据导出 */
  @Column({ length: 10 })
  kind: ScriptLibraryKind;

  /** 运行时脚本仓库 main 分支 HEAD（读取失败为 null） */
  @Column({ type: 'varchar', length: 40, nullable: true })
  revision: string | null;

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
  items: ScriptLibraryRunItem[] | null;

  /** 日志行（结束时写入） */
  @Column({ type: 'json', nullable: true })
  logs: string[] | null;

  /** 脚本原始输出行（终端展示用；运行中实时累积，结束时落库） */
  @Column({ type: 'json', nullable: true })
  output: string[] | null;

  /** 产物文件清单（脚本 [files] 协议上报；file 相对本次运行的输出目录） */
  @Column({ type: 'json', nullable: true })
  files: ScriptLibraryRunFile[] | null;

  @Column({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}

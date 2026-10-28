import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 脚本描述的生成状态：pending 待生成 / running 生成中 / done 完成 / error 失败（重试超限） */
export type ScriptDescriptionStatus = 'pending' | 'running' | 'done' | 'error';

/**
 * 脚本库脚本描述：由「脚本描述机器人」（系统机器人 #3）经 opencode 分析代码生成。
 * 每次脚本同步后比对文件内容哈希，文件变更或描述为空时重新排队生成。
 */
@Entity('script_library_descriptions')
export class ScriptLibraryDescription {
  @PrimaryGeneratedColumn()
  id: number;

  /** 脚本位置：相对脚本根目录的路径（projects/ 下），唯一 */
  @Column({ type: 'varchar', length: 500, unique: true })
  scriptPath: string;

  /** 描述正文（一句话中文） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 生成描述时的文件内容 sha1（文件变更检测；未生成/手动重置为 null） */
  @Column({ type: 'varchar', length: 40, nullable: true })
  contentHash: string | null;

  @Column({ type: 'varchar', length: 20, default: 'pending' })
  status: ScriptDescriptionStatus;

  /** 最近一次失败的错误信息 */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** 连续失败次数（达到上限后停止自动重试，文件变更或手动重新生成时清零） */
  @Column({ type: 'int', default: 0 })
  attempts: number;

  /** 描述生成时间 */
  @Column({ type: 'timestamptz', nullable: true })
  generatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

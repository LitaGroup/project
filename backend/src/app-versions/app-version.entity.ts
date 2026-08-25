import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';

/**
 * APP 版本：每次 APP 自动化测试运行所使用的 app 包元信息。
 * 不存包内容，包由 appium-agent 下载到测试机并按 md5 缓存。
 */
@Entity('app_versions')
@Index(['projectId', 'platform', 'version'])
export class AppVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  projectId: number;

  /** 目标平台：ios / android */
  @Column({ type: 'varchar', length: 20 })
  platform: string;

  /** 目标应用：lita / lita lite */
  @Column({ type: 'varchar', length: 50 })
  appTarget: string;

  /** 版本号（如 1.2.3） */
  @Column({ type: 'varchar', length: 100 })
  version: string;

  /** app 包下载地址（agent 下载并用 md5 校验） */
  @Column({ type: 'text' })
  downloadUrl: string;

  /** app 包 md5（agent 下载后校验，命中缓存则跳过下载） */
  @Column({ type: 'varchar', length: 64 })
  md5: string;

  @Column({ type: 'text', nullable: true })
  remark: string | null;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键（同其它实体，见 AGENTS.md）
  @ManyToOne(() => Project, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

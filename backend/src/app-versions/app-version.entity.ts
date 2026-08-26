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
 * APP 版本：APP 自动化测试运行所针对的 app 版本元信息（平台/应用/版本号）。
 * 不存包内容也不参与执行——APP 包的安装/卸载由 APP 包管理（agent 包目录）统一处理，
 * 脚本运行前由 agent 前置校验模拟器内已装对应 APP。
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

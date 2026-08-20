import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus, ProjectType } from '../common/enums';
import { Check } from '../checks/check.entity';
import { Test } from '../tests/test.entity';
import { Document } from '../documents/document.entity';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'enum', enum: ProjectType, default: ProjectType.OTHER })
  type: ProjectType;

  @Column({ type: 'enum', enum: ProjectStatus, default: ProjectStatus.PLANNED })
  status: ProjectStatus;

  /** 预期发布时间 */
  @Column({ type: 'date', nullable: true })
  expectedReleaseAt: string | null;

  /** 优先级（飞书同步：S0/S1/...），手工项目可空 */
  @Column({ type: 'varchar', length: 20, nullable: true })
  priority: string | null;

  /** 迭代周期（飞书字段 w，如 "w281：08/19 - 08/25"） */
  @Column({ type: 'varchar', length: 50, nullable: true })
  iterationCycle: string | null;

  /** 资源：{ frontend?, backend?, qa? } */
  @Column({ type: 'simple-json', nullable: true })
  resources: { frontend?: string; backend?: string; qa?: string } | null;

  /** 飞书多维表格 record_id，增量同步判重用 */
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  feishuRecordId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 脚本目录：相对 CHECK_SCRIPTS_DIR 的路径，登记检查时只在该子目录下扫描 .check.ts */
  @Column({ type: 'varchar', length: 500, nullable: true })
  scriptsPath: string | null;

  @OneToMany(() => Document, (doc) => doc.project)
  documents: Document[];

  @OneToMany(() => Check, (check) => check.project)
  checks: Check[];

  @OneToMany(() => Test, (test) => test.project)
  tests: Test[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

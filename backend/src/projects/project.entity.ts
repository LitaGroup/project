import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ProjectStatus, ProjectType } from '../common/enums';
import { Check } from '../checks/check.entity';
import { AppVersion } from '../app-versions/app-version.entity';
import { Task } from '../tasks/task.entity';
import { Test } from '../tests/test.entity';
import { Document } from '../documents/document.entity';
import { Defect } from '../defects/defect.entity';

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

  /** 迭代周期（飞书字段 w，同步时归一化为 "w281: 08/19-08/25"，无法识别的一律为 "-"） */
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

  /** 飞书通知群：群机器人 webhook 的 secret（hook 地址最后一段），发送时拼接完整地址；空则回退 FEISHU_WEBHOOK_URL */
  @Column({ type: 'varchar', length: 500, nullable: true })
  feishuWebhook: string | null;

  /** 缺陷多维表格地址（飞书 wiki/base 链接，须带 table 参数，可带 view）；项目的缺陷与该表双向绑定 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  defectBitableUrl: string | null;

  @OneToMany(() => Document, (doc) => doc.project)
  documents: Document[];

  @OneToMany(() => Check, (check) => check.project)
  checks: Check[];

  @OneToMany(() => Test, (test) => test.project)
  tests: Test[];

  @OneToMany(() => Task, (task) => task.project)
  tasks: Task[];

  @OneToMany(() => Defect, (defect) => defect.project)
  defects: Defect[];

  @OneToMany(() => AppVersion, (appVersion) => appVersion.project)
  appVersions: AppVersion[];

  /** 列表按创建时间倒序展示，建索引避免全表 filesort */
  @Index('IDX_projects_createdAt')
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

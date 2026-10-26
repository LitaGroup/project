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
import { Schedule } from '../schedules/schedule.entity';
import { Test } from '../tests/test.entity';
import { Export } from '../exports/export.entity';
import { Document } from '../documents/document.entity';
import { Defect } from '../defects/defect.entity';
import { Resource } from '../resources/resource.entity';
import { Milestone } from '../milestones/milestone.entity';
import { ProjectBranch } from '../github/project-branch.entity';
import { ProjectRelease } from '../releases/project-release.entity';

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

  /** 人员：{ frontend?, backend?, qa?, client? }（需求池同步含客户端人员） */
  @Column({ type: 'simple-json', nullable: true })
  resources: {
    frontend?: string;
    backend?: string;
    qa?: string;
    client?: string;
  } | null;

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

  @OneToMany(() => Document, (doc) => doc.project)
  documents: Document[];

  @OneToMany(() => Check, (check) => check.project)
  checks: Check[];

  @OneToMany(() => Test, (test) => test.project)
  tests: Test[];

  @OneToMany(() => Export, (exportItem) => exportItem.project)
  exports: Export[];

  @OneToMany(() => Schedule, (schedule) => schedule.project)
  schedules: Schedule[];

  @OneToMany(() => Defect, (defect) => defect.project)
  defects: Defect[];

  @OneToMany(() => AppVersion, (appVersion) => appVersion.project)
  appVersions: AppVersion[];

  /** 资源（需求方提供的素材/信息）。命名避开上方人员 resources 列 */
  @OneToMany(() => Resource, (resource) => resource.project)
  projectResources: Resource[];

  /** 节点：项目在某个时间点需要完成的事项（状态由服务层推导，不落库） */
  @OneToMany(() => Milestone, (milestone) => milestone.project)
  milestones: Milestone[];

  /** 代码分支：项目涉及修改的 GitHub 仓库与分支登记 */
  @OneToMany(() => ProjectBranch, (branch) => branch.project)
  projectBranches: ProjectBranch[];

  /** 提测记录（点「提测」生成，倒序展示） */
  @OneToMany(() => ProjectRelease, (release) => release.project)
  projectReleases: ProjectRelease[];

  /** 列表按创建时间倒序展示，建索引避免全表 filesort */
  @Index('IDX_projects_createdAt')
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

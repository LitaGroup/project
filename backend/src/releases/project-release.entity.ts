import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ReleaseStatus } from '../common/enums';
import { Project } from '../projects/project.entity';

/** 提测单上的代码分支（仓库 + 分支，提测时快照，不关联 project_branches 登记） */
export interface ReleaseBranch {
  repo: string;
  branch: string;
}

/**
 * 项目提测记录：点「提测」后生成一条，同时项目状态流转为「测试中」。
 * 允许重复提测（修复后重新提测追加新记录）；删除项目时应用层级联删除。
 */
@Entity('project_releases')
export class ProjectRelease {
  @PrimaryGeneratedColumn()
  id: number;

  // 测试库账号无 REFERENCES 权限，暂不建物理外键；获得授权后可移除该选项
  @ManyToOne(() => Project, (project) => project.projectReleases, {
    createForeignKeyConstraints: false,
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  projectId: number;

  /** 提测内容（Markdown，可空） */
  @Column({ type: 'text', nullable: true })
  content: string | null;

  /** 访问地址（可空） */
  @Column({ type: 'simple-json', nullable: true })
  urls: string[] | null;

  /** 代码分支（仓库+分支 列表，可空） */
  @Column({ type: 'simple-json', nullable: true })
  branches: ReleaseBranch[] | null;

  /** 测试人员姓名（至少 1 个，均须为用户系统内用户） */
  @Column({ type: 'simple-json' })
  testers: string[];

  /** 提测人姓名（网页登录用户 / agent 令牌对应用户） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  /** 提测状态：提测默认「待冒烟」，由测试同学判定「已通过 / 未通过」 */
  @Column({ type: 'varchar', length: 20, default: ReleaseStatus.PENDING })
  status: string;

  /** 判定人姓名（改为已通过/未通过时记录，改回待冒烟时清空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  verifier: string | null;

  /** 判定时间（改为已通过/未通过时记录，改回待冒烟时清空） */
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** 提测时间 */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

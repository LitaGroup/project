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
 * 机器人提测后，新缺陷可自动派回原提测机器人的提测状态。
 * 已通过的提测不再自动派单（缺陷进入下一轮修复/提测流程由人判断）。
 */
export const ACTIVE_RELEASE_STATUSES: readonly ReleaseStatus[] = [
  ReleaseStatus.PENDING,
  ReleaseStatus.IN_PROGRESS,
  ReleaseStatus.FAILED,
];

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

  /** 提测人姓名（网页登录用户 / 绑定真人机器人的令牌 / 机器人名称） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  operator: string | null;

  /**
   * 发起提测的机器人（机器人令牌命中时记录）。
   * 该机器人仍在执行的项目新缺陷会自动创建处理任务并指派给它。
   */
  @Column({ type: 'int', nullable: true })
  workerId: number | null;

  /** 发起提测时机器人正在执行的任务（用于追溯与任务需求方回退） */
  @Column({ type: 'int', nullable: true })
  sourceTaskId: number | null;

  /** 提测状态：待冒烟（默认）/ 进行中 / 已通过 / 未通过 */
  @Column({ type: 'varchar', length: 20, default: ReleaseStatus.PENDING })
  status: string;

  /** 判定人姓名（改为已通过/未通过时记录，待冒烟/进行中时清空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  verifier: string | null;

  /** 判定时间（改为已通过/未通过时记录，待冒烟/进行中时清空） */
  @Column({ type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  /** 提测时间 */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

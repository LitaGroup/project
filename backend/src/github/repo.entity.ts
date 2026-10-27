import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { RepoPlatform, RepoStatus } from '../common/enums';

/**
 * 代码仓库登记：GitHub 组织下仓库的本地视图（按组织仓库清单定时同步）。
 * 端与状态为平台侧维护：忽略后的仓库不再出现在仓库联想、代码分支候选等位置，
 * 存量的项目代码分支登记与提交监听不受影响。
 */
@Entity('repos')
@Index('IDX_repos_full_name', ['fullName'], { unique: true })
export class Repo {
  @PrimaryGeneratedColumn()
  id: number;

  /** 仓库名（如 lita-android） */
  @Column({ type: 'varchar', length: 200 })
  name: string;

  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  @Column({ type: 'varchar', length: 200 })
  fullName: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  htmlUrl: string | null;

  /** 默认分支（通常 main） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  defaultBranch: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  language: string | null;

  /** 端：前端/后端/安卓/苹果/其它（默认其它，平台侧维护） */
  @Column({
    type: 'enum',
    enum: RepoPlatform,
    default: RepoPlatform.OTHER,
  })
  platform: RepoPlatform;

  /** 状态：有效/忽略（忽略后不再出现在联想等候选） */
  @Column({ type: 'enum', enum: RepoStatus, default: RepoStatus.ACTIVE })
  status: RepoStatus;

  /** 仓库最后被更新的时间（GitHub updated_at，随同步刷新） */
  @Column({ type: 'timestamptz', nullable: true })
  lastUpdatedAt: Date | null;

  /** 备注 */
  @Column({ type: 'text', nullable: true })
  remark: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

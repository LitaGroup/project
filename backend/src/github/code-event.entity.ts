import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 代码事件：监听到的 GitHub 提交/合并记录（append-only，只记录不删除）。
 * 与项目无外键：一个 (repo, branch) 可能被多个项目登记，展示时经 project_branches 动态匹配。
 * 后续动作（代码 review / 自动化测试等）基于新事件触发（见 github-watch.service 的事件总线）。
 */
@Entity('code_events')
@Index('IDX_code_events_unique', ['repo', 'branch', 'sha'], { unique: true })
@Index('IDX_code_events_committedAt', ['committedAt'])
export class CodeEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /** 仓库全名（owner/name，如 LitaGroup/lita-android） */
  @Column({ type: 'varchar', length: 200 })
  repo: string;

  /** 分支名 */
  @Column({ type: 'varchar', length: 200 })
  branch: string;

  /** 提交 SHA（40 位） */
  @Column({ type: 'varchar', length: 40 })
  sha: string;

  /** 提交信息全文 */
  @Column({ type: 'text' })
  message: string;

  /** 提交作者名 */
  @Column({ type: 'varchar', length: 200, nullable: true })
  author: string | null;

  /** 是否合并提交（parents > 1） */
  @Column({ type: 'boolean' })
  isMerge: boolean;

  /** 提交页面链接 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;

  /** 提交时间（GitHub commit.author.date） */
  @Column({ type: 'timestamptz' })
  committedAt: Date;

  /** 平台发现该提交的时间 */
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

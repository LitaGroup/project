import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkerRole, WorkerRuntime } from '../common/enums';

/** 智能体的任务定义：接什么类型的任务、要什么输入、产出什么、怎么完成 */
export interface WorkerTaskDefInput {
  name: string;
  desc?: string;
  required?: boolean;
}

export interface WorkerTaskDefOutput {
  name: string;
  desc?: string;
}

export interface WorkerTaskDef {
  /** 任务类型（task_types.name 或历史自定义值） */
  type: string;
  inputs: WorkerTaskDefInput[];
  outputs: WorkerTaskDefOutput[];
  /** 完成方式说明 */
  how?: string;
}

/** 技能清单条目：技能库 SKILL.md 的引用（保存后安装到工位 .opencode/skills） */
export interface WorkerSkill {
  /** 展示名（frontmatter name，缺失时取目录名） */
  name: string;
  /** 仓库内 SKILL.md 相对路径，如 active/rank/SKILL.md */
  path: string;
  /** 原始文件下载地址（raw） */
  url: string;
  /** 描述（frontmatter description） */
  description?: string | null;
  /** 版本（frontmatter version） */
  version?: string | null;
  /** Gitea 页面地址（查看原文） */
  sourceUrl?: string | null;
}

/** 规范清单条目：规范库 README.md 的引用（选中即同步其目录到工位 .opencode/docs） */
export interface WorkerStandard {
  /** 展示名（README frontmatter name/title，缺失时取目录名） */
  name: string;
  /** 仓库内 README.md 相对路径，如 fe/h5/README.md */
  path: string;
  /** README 所在目录（同步到 .opencode/docs 的源目录），如 fe/h5 */
  directory: string;
  /** 原始文件下载地址（raw） */
  url: string;
  /** 描述（frontmatter description） */
  description?: string | null;
  /** 版本（frontmatter version） */
  version?: string | null;
  /** Gitea 页面地址（查看原文） */
  sourceUrl?: string | null;
}

/** 机器人：工作者与调度机器人统一实体。
 * 统一运行在执行器上（opencode 等），不再使用平台进程内 PI Agent。 */
@Entity('workers')
export class Worker {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  /** 系统机器人稳定标识（如 scheduler / unknown-task）；自定义机器人为空 */
  @Column({ type: 'varchar', length: 50, nullable: true, unique: true })
  systemKey: string | null;

  /** 简介：擅长什么、能接什么任务（供调度机器人与外部选择） */
  @Column({ type: 'text', nullable: true })
  intro: string | null;

  /** 头像：POST /api/images 上传后返回的 /images/... 路径（空为默认黑底占位头像） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'enum', enum: WorkerRole, default: WorkerRole.WORKER })
  role: WorkerRole;

  @Column({
    type: 'enum',
    enum: WorkerRuntime,
    default: WorkerRuntime.OPENCODE,
  })
  runtime: WorkerRuntime;

  /** 执行器（所有机器人必填，统一走执行器运行） */
  @Column({ type: 'int', nullable: true })
  executorId: number | null;

  /** 供应商 id（取执行器供应商缓存） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  providerId: string | null;

  /** 模型 id */
  @Column({ type: 'varchar', length: 200, nullable: true })
  modelId: string | null;

  /** 机器人定义 AGENTS.md（Markdown，保存后同步到工位） */
  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  /** 技能清单（技能库 SKILL.md 引用，保存后同步到工位） */
  @Column({ type: 'simple-json', nullable: true })
  skills: WorkerSkill[] | null;

  /** 规范清单（规范库 README.md 引用，初始化时按目录同步到工位 .opencode/docs） */
  @Column({ type: 'simple-json', nullable: true })
  standards: WorkerStandard[] | null;

  /** 任务定义（接什么活） */
  @Column({ type: 'simple-json', nullable: true })
  taskDefs: WorkerTaskDef[] | null;

  /** 责任人（用户系统内，验收任务产出） */
  @Column({ type: 'int', nullable: true })
  ownerUserId: number | null;

  /** 责任人姓名快照（展示用，选人时同步写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  ownerName: string | null;

  /**
   * 机器人独立访问令牌：仅用于需要严格识别执行机器人的 Agent 接口（如任务验收申请）。
   * 禁止出现在机器人列表/详情响应中；首次派发时自动生成并写入工位。
   */
  @Index('IDX_workers_agentToken', { unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true, select: false })
  agentToken: string | null;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkerKind, WorkerRole, WorkerRuntime } from '../common/enums';

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

  @Column({ type: 'enum', enum: WorkerKind, default: WorkerKind.AGENT })
  kind: WorkerKind;

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

  /** 任务定义（接什么活） */
  @Column({ type: 'simple-json', nullable: true })
  taskDefs: WorkerTaskDef[] | null;

  /** 责任人（用户系统内，验收任务产出） */
  @Column({ type: 'int', nullable: true })
  ownerUserId: number | null;

  /** 责任人姓名快照（展示用，选人时同步写入） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  ownerName: string | null;

  /** 调度材料（仅调度机器人：识别时附加的背景材料，Markdown） */
  @Column({ type: 'text', nullable: true })
  materials: string | null;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

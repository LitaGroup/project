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
  /** 任务类型（TaskType 值或自定义） */
  type: string;
  inputs: WorkerTaskDefInput[];
  outputs: WorkerTaskDefOutput[];
  /** 完成方式说明 */
  how?: string;
}

/** 技能清单条目：技能名 + MD 内容（派发时随 prompt 下发/附件） */
export interface WorkerSkill {
  name: string;
  content: string;
}

/** 机器人：工作者（智能体/员工）与调度器统一实体。
 * runtime=opencode 跑在执行器上；runtime=pi 为平台进程内 PI Agent（调度器用）。 */
@Entity('workers')
export class Worker {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  /** 简介：擅长什么、能接什么任务（供调度器与外部选择） */
  @Column({ type: 'text', nullable: true })
  intro: string | null;

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

  /** 执行器（runtime=opencode 必填） */
  @Column({ type: 'int', nullable: true })
  executorId: number | null;

  /** 供应商 id（runtime=opencode 取执行器供应商缓存；runtime=pi 取 PI 供应商） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  providerId: string | null;

  /** 模型 id */
  @Column({ type: 'varchar', length: 200, nullable: true })
  modelId: string | null;

  /** 角色定义 PROMPT */
  @Column({ type: 'text', nullable: true })
  prompt: string | null;

  /** 技能清单 */
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

  /** 调度材料（仅调度器：调度时附加给 PI 的背景材料，Markdown） */
  @Column({ type: 'text', nullable: true })
  materials: string | null;

  @Column({ default: true })
  enabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

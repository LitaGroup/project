import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WorkflowDefinitionJson } from './workflow.types';

/**
 * 工单定义：一类工单对应一个由任务节点组成的工作流。
 * 当前只允许使用系统内置定义，不开放网页新建/删除。
 */
@Entity('workflow_definitions')
@Index('IDX_workflow_definitions_category', ['category'], { unique: true })
export class WorkflowDefinition {
  @PrimaryGeneratedColumn()
  id: number;

  /** 稳定编码（系统内置定义由代码预置，不允许网页修改） */
  @Column({ type: 'varchar', length: 64, unique: true })
  code: string;

  /** 工单类型（系统内置：测试工单、发布工单） */
  @Column({ type: 'varchar', length: 64 })
  category: string;

  /** 流程名称 */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 系统内置：不可通过网页创建/删除 */
  @Column({ default: true })
  builtIn: boolean;

  /** 是否启用；停用不影响已创建的流程实例 */
  @Column({ default: true })
  enabled: boolean;

  /** 草稿定义；保存草稿不创建新版本 */
  @Column({ type: 'jsonb' })
  draftDefinition: WorkflowDefinitionJson;

  /** 最新发布版本号，0 表示尚未发布 */
  @Column({ type: 'int', default: 0 })
  latestPublishedVersion: number;

  @Column({ type: 'timestamptz', nullable: true })
  latestPublishedAt: Date | null;

  /** 最近一次保存草稿时间；发布后清空 */
  @Column({ type: 'timestamptz', nullable: true })
  draftUpdatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

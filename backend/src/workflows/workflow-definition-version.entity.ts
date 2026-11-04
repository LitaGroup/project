import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { WorkflowDefinitionJson } from './workflow.types';

/**
 * 工单定义发布版本：发布后不可变。
 * 已创建的工作流实例应固定引用创建时选中的版本。
 */
@Entity('workflow_definition_versions')
@Index(
  'IDX_workflow_definition_versions_definition_version',
  ['definitionId', 'version'],
  {
    unique: true,
  },
)
export class WorkflowDefinitionVersion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int' })
  definitionId: number;

  @Column({ type: 'int' })
  version: number;

  /** 发布时的流程名称快照 */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 发布时的流程描述快照 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 不可变流程定义 */
  @Column({ type: 'jsonb' })
  definition: WorkflowDefinitionJson;

  @Column({ type: 'int', nullable: true })
  publishedById: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  publishedByName: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  publishedAt: Date;
}

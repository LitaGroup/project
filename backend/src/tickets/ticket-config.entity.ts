import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 历史工单配置（旧调度模型遗留）：保存当时按类别绑定的默认调度任务定义与可转交清单。
 * 工单已改为工作流模型，不再按类别创建；该表仅为存量工单的 ticket-route 转交通道保留。
 */
@Entity('ticket_configs')
export class TicketConfig {
  /** 工单类别（历史调度工单的类别） */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  category: string;

  /** 当时的默认调度任务定义 ID（定义已退役，仅保留历史数据） */
  @Column({ type: 'int' })
  defaultTemplateId: number;

  /** 可转交的后续任务定义 ID 列表（历史转交通道仍在使用） */
  @Column({ type: 'simple-json', default: '[]' })
  allowedTemplateIds: number[];

  /** 是否开放创建（旧模型字段；新工单一律走工作流，此字段不再生效） */
  @Column({ default: false })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

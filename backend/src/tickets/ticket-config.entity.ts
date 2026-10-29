import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 工单类型配置：固定默认调度任务定义 + 调度机器人可转交的后续任务定义清单。
 * 默认定义由平台按工单类型锁定，配置页只允许维护可转派清单。
 */
@Entity('ticket_configs')
export class TicketConfig {
  /** 工单类型（与固定默认调度任务定义一一对应） */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  category: string;

  /** 默认调度任务定义（固定系统定义 ID，不在此处换绑） */
  @Column({ type: 'int' })
  defaultTemplateId: number;

  /** 可转交的后续任务定义 ID 列表（排除系统调度定义） */
  @Column({ type: 'simple-json', default: '[]' })
  allowedTemplateIds: number[];

  /** 是否开放创建；当前仅方案工单为 true */
  @Column({ default: false })
  enabled: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

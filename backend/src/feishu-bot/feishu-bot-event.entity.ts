import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 飞书事件去重：event_id 唯一，重复推送直接跳过（飞书至少一次投递） */
@Entity('feishu_bot_events')
export class FeishuBotEvent {
  @PrimaryGeneratedColumn()
  id: number;

  /** 飞书事件 header.event_id */
  @Column({ type: 'varchar', length: 120, unique: true })
  eventId: string;

  /** 所属飞书配置 */
  @Column({ type: 'int' })
  configId: number;

  /** 事件类型（im.message.receive_v1 等，仅记录） */
  @Column({ type: 'varchar', length: 80, nullable: true })
  type: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 飞书用户身份映射：飞书 open_id 是应用维度的，独立应用的 open_id 与
 * users.feishuOpenId（OAuth 应用）不通用，按「配置 + openId」缓存解析结果。
 * 首次解析尝试 union_id / 同应用 open_id 匹配，未识别的用户不发 Agent。
 */
@Entity('feishu_bot_identities')
@Index('IDX_feishu_bot_identities_openId', ['configId', 'openId'], {
  unique: true,
})
@Index('IDX_feishu_bot_identities_userId', ['userId'])
export class FeishuBotIdentity {
  @PrimaryGeneratedColumn()
  id: number;

  /** 所属飞书配置 */
  @Column({ type: 'int' })
  configId: number;

  /** 飞书 open_id（该应用维度） */
  @Column({ type: 'varchar', length: 100 })
  openId: string;

  /** 飞书 union_id（可空；跨应用识别备用） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  unionId: string | null;

  /** 平台用户 */
  @Column({ type: 'int' })
  userId: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

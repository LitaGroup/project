import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * SSO 一次性授权码：authorize 为已登录用户签发，token 端点消费。
 * 10 分钟有效、一次性（usedAt 标记），并绑定 user / client / redirect_uri 三元组。
 */
@Entity('sso_codes')
@Index('IDX_sso_codes_clientId', ['clientId'])
@Index('IDX_sso_codes_userId', ['userId'])
export class SsoCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('UQ_sso_codes_code', { unique: true })
  @Column({ length: 64 })
  code: string;

  /** 签发接入方的 clientId（应用层软引用 sso_clients.clientId，无物理外键） */
  @Column({ length: 64 })
  clientId: string;

  @Column()
  userId: number;

  /** 发码时的回调地址；换 token 时必须与之一致 */
  @Column({ type: 'varchar', length: 500 })
  redirectUri: string;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  /** 一次性消费标记；非 null 即已作废 */
  @Column({ type: 'timestamptz', nullable: true })
  usedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

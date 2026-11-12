import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** SSO 接入方视图（管理区列表/详情返回）。密钥只写不读：仅返回是否已配置。 */
export interface SsoClientView {
  id: number;
  name: string;
  clientId: string;
  /** 回调地址白名单（精确匹配） */
  redirectUris: string[];
  enabled: boolean;
  remark: string | null;
  hasSecret: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** 新建接入方响应：clientSecret 仅本次一次性返回，之后不可再查看 */
export interface SsoClientCreated extends SsoClientView {
  clientSecret: string;
}

/** 保存 SSO 接入方入参（创建与编辑共用；编辑未传字段保持原值） */
export interface SaveSsoClientInput {
  name?: string;
  redirectUris?: string[];
  enabled?: boolean;
  remark?: string | null;
}

/**
 * 单点登录接入方应用（管理区「SSO 应用」维护）。
 * 其它网站以 OAuth2 授权码模式接入平台登录：authorize 发码 → token 换 access_token → userinfo。
 * clientSecret 只写不回显（select:false），仅创建/重置时一次性返回。
 */
@Entity('sso_clients')
export class SsoClient {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Index('UQ_sso_clients_clientId', { unique: true })
  @Column({ length: 64 })
  clientId: string;

  /** 只写不回显；不进响应、日志与审计 */
  @Column({ type: 'varchar', length: 128, select: false })
  clientSecret: string;

  /** 回调地址白名单（simple-json 存 string[]；http/https 精确匹配） */
  @Column({ type: 'simple-json' })
  redirectUris: string[];

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

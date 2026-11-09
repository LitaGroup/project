import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 配置类型：official=平台官方机器人（全平台唯一）/ worker=机器人绑定的独立飞书应用 */
export type FeishuBotConfigKind = 'official' | 'worker';

/**
 * 飞书机器人应用配置：每个机器人（或平台官方）一份自建应用凭据。
 * APP Secret / Verification Token / Encrypt Key 使用 AES-256-GCM 加密落库，
 * 密文字段全部 select:false，任何列表/详情响应不得带出明文或密文。
 */
@Entity('feishu_bot_configs')
@Index('IDX_feishu_bot_configs_kind', ['kind'])
@Index('IDX_feishu_bot_configs_workerId', ['workerId'], { unique: true })
export class FeishuBotConfig {
  @PrimaryGeneratedColumn()
  id: number;

  /** official / worker */
  @Column({ type: 'varchar', length: 20 })
  kind: FeishuBotConfigKind;

  /** 绑定的机器人（workers.id；official 为 null） */
  @Column({ type: 'int', nullable: true })
  workerId: number | null;

  /** 展示名（official 固定「平台官方机器人」；worker 保存机器人名快照） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  name: string | null;

  /** 飞书自建应用 APP ID（全平台唯一：一个应用只能是一个飞书机器人） */
  @Column({ type: 'varchar', length: 100 })
  appId: string;

  /** APP Secret AES-256-GCM 密文（base64） */
  @Column({ type: 'text', select: false })
  secretCiphertext: string;

  /** APP Secret AES-256-GCM 随机 IV（base64） */
  @Column({ type: 'text', select: false })
  secretIv: string;

  /** APP Secret AES-256-GCM 认证标签（base64） */
  @Column({ type: 'text', select: false })
  secretAuthTag: string;

  /** 加密密钥版本，便于主密钥轮换后重加密 */
  @Column({ type: 'varchar', length: 30, select: false })
  keyVersion: string;

  /** 事件 Verification Token 密文（base64；可空=未配置） */
  @Column({ type: 'text', select: false, nullable: true })
  verificationTokenCiphertext: string | null;

  /** 事件 Verification Token IV（base64） */
  @Column({ type: 'text', select: false, nullable: true })
  verificationTokenIv: string | null;

  /** 事件 Verification Token 认证标签（base64） */
  @Column({ type: 'text', select: false, nullable: true })
  verificationTokenAuthTag: string | null;

  /** 事件 Encrypt Key 密文（base64；可空=未配置） */
  @Column({ type: 'text', select: false, nullable: true })
  encryptKeyCiphertext: string | null;

  /** 事件 Encrypt Key IV（base64） */
  @Column({ type: 'text', select: false, nullable: true })
  encryptKeyIv: string | null;

  /** 事件 Encrypt Key 认证标签（base64） */
  @Column({ type: 'text', select: false, nullable: true })
  encryptKeyAuthTag: string | null;

  /** 消息处理策略覆盖（typingEmoji 等；三级策略的最上层暂只预留结构） */
  @Column({ type: 'simple-json', default: '{}' })
  policy: Record<string, unknown>;

  /** 是否启用：停用后不接收事件、不参与任务群 */
  @Column({ default: true })
  enabled: boolean;

  /** 首次绑定时间 */
  @Column({ type: 'timestamptz', nullable: true })
  boundAt: Date | null;

  /** 最近一次连接验证成功时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastVerifiedAt: Date | null;

  /** 最近一次验证/收发错误（展示用） */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** 带密文的配置载入结果（仅服务端内部流转，禁止出参） */
export interface FeishuBotSecrets {
  appId: string;
  appSecret: string;
  verificationToken: string | null;
  encryptKey: string | null;
}

/** 管理页可见的配置视图（不含任何密文与 Secret） */
export interface FeishuBotConfigView {
  id: number;
  kind: FeishuBotConfigKind;
  workerId: number | null;
  name: string | null;
  appId: string;
  enabled: boolean;
  secretConfigured: boolean;
  verificationTokenConfigured: boolean;
  encryptKeyConfigured: boolean;
  callbackUrl: string;
  boundAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 保存输入：已配置时 Secret 类字段留空即保持不变 */
export interface SaveFeishuBotConfigInput {
  appId?: string;
  appSecret?: string | null;
  verificationToken?: string | null;
  encryptKey?: string | null;
  enabled?: boolean;
}

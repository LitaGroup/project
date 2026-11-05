import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkerGithubPermission } from '../common/enums';

/**
 * 权限档位 GitHub 凭证：全平台仅两条记录（开发权限 / 发布权限），每个档位一个 PAT。
 * PAT 使用 AES-256-GCM 加密后落库；密文字段全部 select:false，任何列表/详情响应不得带出。
 * 机器人归属哪个档位保存在 workers.githubPermission，本表只保存档位凭证。
 */
@Entity('github_permission_credentials')
@Index('IDX_github_permission_credentials_permission', ['permission'], {
  unique: true,
})
export class GithubPermissionCredential {
  @PrimaryGeneratedColumn()
  id: number;

  /** 权限档位：develop（开发权限）/ release（发布权限） */
  @Column({ type: 'varchar', length: 20 })
  permission: WorkerGithubPermission;

  /** PAT 所属 GitHub 机器账号（保存 PAT 时经 GitHub API 自动识别，识别失败为空） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  githubAccount: string | null;

  /** AES-256-GCM 密文（base64） */
  @Column({ type: 'text', select: false })
  patCiphertext: string;

  /** AES-256-GCM 随机 IV（base64） */
  @Column({ type: 'text', select: false })
  patIv: string;

  /** AES-256-GCM 认证标签（base64） */
  @Column({ type: 'text', select: false })
  patAuthTag: string;

  /** 加密密钥版本，便于主密钥轮换后重加密 */
  @Column({ type: 'varchar', length: 30, select: false })
  keyVersion: string;

  /** 是否启用：停用后 Gateway 无法取得该档位凭证 */
  @Column({ default: true })
  enabled: boolean;

  /** 最近一次配置/更换 PAT 的时间 */
  @Column({ type: 'timestamptz', nullable: true })
  rotatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

/** 管理页/初始化说明可见的档位凭证状态（不含任何密文与 PAT） */
export interface GithubCredentialStatus {
  configured: boolean;
  enabled: boolean;
  githubAccount: string | null;
  rotatedAt: string | null;
}

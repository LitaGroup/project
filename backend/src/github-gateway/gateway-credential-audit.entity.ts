import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Gateway 凭证获取审计：append-only，只记录结果与原因，禁止记录 Token / PAT。
 */
@Entity('gateway_credential_audits')
@Index('IDX_gateway_credential_audits_workerId', ['workerId'])
@Index('IDX_gateway_credential_audits_leaseId', ['leaseId'])
export class GatewayCredentialAudit {
  @PrimaryGeneratedColumn()
  id: number;

  /** 本次授权租用 ID（成功时生成；失败为空） */
  @Column({ type: 'varchar', length: 80, nullable: true })
  leaseId: string | null;

  @Column({ type: 'int' })
  workerId: number;

  @Column({ type: 'int', nullable: true })
  credentialId: number | null;

  /** github.pat / postgresql.account / redis.auth ...（未支持类型原样记录） */
  @Column({ type: 'varchar', length: 60 })
  credentialType: string;

  /** 授权资源（GitHub 仓库 owner/name 等） */
  @Column({ type: 'varchar', length: 200 })
  resource: string;

  /** 请求操作（git.read / git.write / gh.pr.create ...） */
  @Column({ type: 'varchar', length: 60 })
  action: string;

  @Column({ type: 'boolean' })
  allowed: boolean;

  /** 拒绝/失败原因码（成功为空） */
  @Column({ type: 'varchar', length: 80, nullable: true })
  denyReason: string | null;

  /** Gateway 请求 ID（透传，用于链路追踪） */
  @Column({ type: 'varchar', length: 120, nullable: true })
  requestId: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}

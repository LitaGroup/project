import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ExecutorType } from '../common/enums';

/** 供应商缓存条目内的模型（id/modelID 同值，name 展示用） */
export interface ExecutorProviderModel {
  id: string;
  name: string;
}

/** 供应商缓存条目（从执行器 GET /api/provider + GET /api/model 拉取合并） */
export interface ExecutorProvider {
  id: string;
  name: string;
  models: ExecutorProviderModel[];
}

/** 执行器：实际执行任务的工具实例（本期仅 opencode server） */
@Entity('executors')
export class Executor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, unique: true })
  name: string;

  /** 部署机器地址 */
  @Column({ length: 200 })
  ip: string;

  /** 对外端口 */
  @Column()
  port: number;

  @Column({ type: 'enum', enum: ExecutorType, default: ExecutorType.OPENCODE })
  type: ExecutorType;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** opencode server password（HTTP Basic 鉴权，用户名固定 opencode；空 = 无鉴权） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  token: string | null;

  @Column({ default: true })
  enabled: boolean;

  /** 在线状态（健康检查 GET /api/info 成功 = 在线；落库供列表直接展示） */
  @Column({ default: false })
  online: boolean;

  /** opencode 版本号（健康检查时刷新） */
  @Column({ type: 'varchar', length: 50, nullable: true })
  version: string | null;

  /** server 默认工作目录（GET /api/location 的 directory，健康检查时刷新） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  defaultLocation: string | null;

  /** 供应商与模型清单缓存（手动同步 + 每日刷新） */
  @Column({ type: 'simple-json', nullable: true })
  providersCache: ExecutorProvider[] | null;

  @Column({ type: 'datetime', nullable: true })
  providersSyncedAt: Date | null;

  @Column({ type: 'datetime', nullable: true })
  lastCheckedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

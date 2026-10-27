import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from '../common/enums';

/**
 * 用户：飞书 OAuth 网页登录后落库的身份。
 * 登录仅用于身份展示与记录（接口不拦截），首个登录的用户自动授予管理员。
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  /** 飞书 open_id（应用内唯一，登录判重 key） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  feishuOpenId: string;

  /** 飞书 union_id（可空，应用未开通相关权限时为空） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  unionId: string | null;

  /** 姓名 */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 头像 URL（可空） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string | null;

  /** 邮箱（可空，应用无「获取用户邮箱」权限时为空） */
  @Column({ type: 'varchar', length: 200, nullable: true })
  email: string | null;

  /** 部门名（主部门，可空；应用无通讯录读权限时为空，顶栏用户区展示用） */
  @Column({ type: 'varchar', length: 100, nullable: true })
  department: string | null;

  /** 角色：管理员/成员（首个登录用户自动为管理员） */
  @Column({ type: 'varchar', length: 10, default: UserRole.MEMBER })
  role: UserRole;

  /** 是否启用：false 时视为未登录（预留字段，暂仅 DB 手工操作） */
  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** 最近登录时间 */
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  /** agent 访问令牌：agent 调 .md 端点时经 X-Agent-Token 头或 ?token= 提供（个人中心可重置，空=尚未发放） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  agentToken: string | null;

  /** 飞书 user_access_token：登录时落库，当前无消费方（原云文档搜索已下线），禁止出参（select:false） */
  @Column({ type: 'text', nullable: true, select: false })
  feishuAccessToken: string | null;

  /** 飞书 OAuth refresh_token：预留给后续需要用户身份的接口（同样禁止出参） */
  @Column({ type: 'text', nullable: true, select: false })
  feishuRefreshToken: string | null;

  /** 飞书 user_access_token 过期时间（本地时钟） */
  @Column({ type: 'timestamptz', nullable: true })
  feishuTokenExpiresAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

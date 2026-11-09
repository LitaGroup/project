import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { McpAuthMode, McpServerType } from '../common/enums';

/**
 * MCP 服务配置视图（管理区列表/详情返回）。
 * 固定令牌只写不读：只返回「是否已配置」，不回显任何凭据内容；
 * env 模式返回环境变量名（非敏感，用于编辑回显）。
 */
export interface McpServerView {
  id: number;
  name: string;
  type: McpServerType;
  url: string | null;
  command: string[] | null;
  authMode: McpAuthMode;
  authHeader: string;
  authPrefix: string | null;
  /** fixed 模式是否已保存固定令牌 */
  hasSecret: boolean;
  /** env 模式的环境变量名（非敏感） */
  envName: string | null;
  enabled: boolean;
  remark: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 保存 MCP 服务入参（创建与编辑共用；未传字段在编辑时保持原值） */
export interface SaveMcpServerInput {
  name?: string;
  type?: McpServerType | string;
  url?: string | null;
  /** 本地 stdio 命令（数组；也接受按空白拆分的字符串） */
  command?: string[] | string | null;
  authMode?: McpAuthMode | string;
  /** 鉴权请求头名（remote）或目标环境变量名（local） */
  authHeader?: string | null;
  /** 鉴权值前缀，如 Bearer */
  authPrefix?: string | null;
  /** fixed：令牌原文（只写不回显）；env：环境变量名；work-token/none：忽略 */
  authSecret?: string | null;
  enabled?: boolean;
  remark?: string | null;
}

/**
 * 机器人可用的外部 MCP 服务配置（管理区「MCP 配置」维护）。
 * 机器人在创建/编辑页多选，初始化与派发时与平台 lita-work 一起写入工位
 * `.opencode/opencode.json` 的 mcp.servers。
 * `name` 同时作为 opencode 服务标识（工具名前缀），限字母、数字、- 和 _。
 */
@Entity('mcp_servers')
export class McpServer {
  @PrimaryGeneratedColumn()
  id: number;

  @Index('IDX_mcp_servers_name', { unique: true })
  @Column({ length: 100 })
  name: string;

  @Column({
    type: 'enum',
    enum: McpServerType,
    default: McpServerType.REMOTE,
  })
  type: McpServerType;

  /** remote：MCP Streamable HTTP 绝对地址 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  url: string | null;

  /** local：stdio 命令（可执行文件 + 参数） */
  @Column({ type: 'simple-json', nullable: true })
  command: string[] | null;

  @Column({
    type: 'enum',
    enum: McpAuthMode,
    default: McpAuthMode.NONE,
  })
  authMode: McpAuthMode;

  /** remote：请求头名（默认 Authorization）；local：传给命令的环境变量名（默认 MCP_API_KEY） */
  @Column({ type: 'varchar', length: 64, default: 'Authorization' })
  authHeader: string;

  /** 鉴权值前缀（如 Bearer），与令牌之间自动补一个空格 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  authPrefix: string | null;

  /**
   * 凭据：fixed 为固定令牌原文；env 为环境变量名；其它模式为空。
   * 只经服务端拼进工位 shell 命令落盘，不回显、不进日志与 Prompt。
   */
  @Column({ type: 'varchar', length: 512, nullable: true, select: false })
  authSecret: string | null;

  @Column({ default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}

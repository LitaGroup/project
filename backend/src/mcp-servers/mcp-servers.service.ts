import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { In, Repository } from 'typeorm';
import { McpAuthMode, McpServerType } from '../common/enums';
import { OpencodeMcpServerConfig } from '../workers/worker-env';
import { Worker } from '../workers/worker.entity';
import {
  McpServer,
  McpServerOption,
  McpServerView,
  SaveMcpServerInput,
} from './mcp-server.entity';

/** 平台固定注入的 lita-work MCP 服务名 */
export const LITA_WORK_SERVER_NAME = 'lita-work';

/** 连接测试超时（毫秒） */
const TEST_TIMEOUT_MS = 10_000;

/** 服务标识：同时作为 opencode mcp.servers key 与工具名前缀 */
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
/** 环境变量名 */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** MCP 配置连接测试结果 */
export interface McpServerTestResult {
  /**
   * connected：握手并列出工具成功；
   * auth-rejected：端点可达但鉴权被拒绝（401/403）；
   * unreachable：超时、网络错误、本地命令无法拉起等。
   */
  status: 'connected' | 'auth-rejected' | 'unreachable';
  message: string;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  tools: string[];
  durationMs: number;
}

/** 解析并归一 MCP 服务类型 */
function parseType(value: unknown): McpServerType {
  if (value === McpServerType.REMOTE) return McpServerType.REMOTE;
  if (value === McpServerType.LOCAL) return McpServerType.LOCAL;
  throw new BadRequestException(
    '类型仅支持 remote（Streamable HTTP）或 local（stdio 本地命令）',
  );
}

/** 解析并归一鉴权方式 */
function parseAuthMode(value: unknown): McpAuthMode {
  if (value === McpAuthMode.NONE) return McpAuthMode.NONE;
  if (value === McpAuthMode.FIXED) return McpAuthMode.FIXED;
  if (value === McpAuthMode.ENV) return McpAuthMode.ENV;
  if (value === McpAuthMode.WORK_TOKEN) return McpAuthMode.WORK_TOKEN;
  throw new BadRequestException(
    '鉴权方式仅支持 none / fixed / env / work-token',
  );
}

/** 空值归一：去空白，空串按 null 处理 */
function trimOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** 本地命令归一：数组逐项去空白；字符串按空白拆分 */
function normalizeCommand(value: unknown): string[] | null {
  const parts = Array.isArray(value)
    ? value.map((item) => String(item).trim())
    : typeof value === 'string'
      ? value.trim().split(/\s+/)
      : [];
  const command = parts.filter(Boolean);
  return command.length ? command : null;
}

/** 鉴权值前缀归一：统一去掉末尾空格，拼接时补一个空格 */
function applyAuthPrefix(prefix: string | null, value: string): string {
  return prefix ? `${prefix} ${value}` : value;
}

/** 按鉴权方式生成写入配置的鉴权值；none 或无凭据时返回 null */
export function authValueOf(
  row: Pick<McpServer, 'authMode' | 'authHeader' | 'authPrefix' | 'authSecret'>,
  workerToken: string,
): string | null {
  switch (row.authMode) {
    case McpAuthMode.FIXED:
      return row.authSecret
        ? applyAuthPrefix(row.authPrefix, row.authSecret)
        : null;
    case McpAuthMode.ENV:
      return row.authSecret
        ? applyAuthPrefix(row.authPrefix, `{env:${row.authSecret}}`)
        : null;
    case McpAuthMode.WORK_TOKEN:
      return applyAuthPrefix(row.authPrefix, workerToken);
    default:
      return null;
  }
}

/**
 * 单个 MCP 行 → opencode server 配置（remote 使用 headers，local 使用 environment）。
 * remote 与 local 的 authHeader 语义不同：前者是请求头名，后者是传给命令的环境变量名。
 */
export function buildOpencodeServerConfig(
  row: Pick<
    McpServer,
    | 'type'
    | 'url'
    | 'command'
    | 'authMode'
    | 'authHeader'
    | 'authPrefix'
    | 'authSecret'
  >,
  workerToken: string,
): OpencodeMcpServerConfig {
  const config: OpencodeMcpServerConfig =
    row.type === McpServerType.LOCAL
      ? { type: 'local', command: row.command ?? [] }
      : { type: 'remote', url: row.url ?? '', oauth: false };
  const value = authValueOf(row, workerToken);
  if (!value) return config;
  if (row.type === McpServerType.LOCAL) {
    config.environment = { [row.authHeader]: value };
  } else {
    config.headers = { [row.authHeader]: value };
  }
  return config;
}

/**
 * 机器人 MCP 配置（管理区「MCP 配置」）。
 * - 管理 CRUD（固定令牌只写不回显）；
 * - 为工位生成 opencode mcp.servers（平台 lita-work + 机器人勾选的启用项）；
 * - 平台侧连接测试（Streamable HTTP / stdio 握手后 listTools）。
 */
@Injectable()
export class McpServersService {
  private readonly logger = new Logger(McpServersService.name);

  constructor(
    @InjectRepository(McpServer)
    private readonly servers: Repository<McpServer>,
    // 直接注册 Worker 实体做软引用校验与删除清理（不 import WorkersModule，避免循环依赖）
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  /** 管理区列表（固定令牌只返回是否已配置） */
  async list(): Promise<McpServerView[]> {
    const rows = await this.servers
      .createQueryBuilder('mcp')
      .addSelect('mcp.authSecret')
      .orderBy('mcp.id', 'ASC')
      .getMany();
    return rows.map((row) => this.toView(row));
  }

  async findOneView(id: number): Promise<McpServerView> {
    return this.toView(await this.findOneWithSecret(id));
  }

  /**
   * 机器人可选的 MCP 服务清单（登录用户可用）。
   * 个人中心「助理配置」等非管理入口按此清单勾选，不返回地址、命令与凭据。
   */
  async listOptions(): Promise<McpServerOption[]> {
    const rows = await this.servers.find({ order: { id: 'ASC' } });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      enabled: row.enabled,
      remark: row.remark,
    }));
  }

  async create(input: SaveMcpServerInput): Promise<McpServerView> {
    const row = new McpServer();
    row.name = '';
    row.type = McpServerType.REMOTE;
    row.url = null;
    row.command = null;
    row.authMode = McpAuthMode.NONE;
    row.authHeader = '';
    row.authPrefix = null;
    row.authSecret = null;
    row.enabled = true;
    row.remark = null;
    this.applyInput(row, input);
    await this.assertNameUnique(row.name);
    this.assertFields(row);
    const saved = await this.servers.save(row);
    return this.findOneView(saved.id);
  }

  async update(id: number, input: SaveMcpServerInput): Promise<McpServerView> {
    const row = await this.findOneWithSecret(id);
    const previousAuthMode = row.authMode;
    this.applyInput(row, input, previousAuthMode);
    await this.assertNameUnique(row.name, id);
    this.assertFields(row);
    await this.servers.save(row);
    return this.findOneView(id);
  }

  /** 删除配置并从所有机器人的 MCP 选择中移除该 id（应用层软引用清理） */
  async remove(id: number): Promise<void> {
    const row = await this.findOneWithSecret(id);
    await this.servers.remove(row);
    const workers = await this.workers.find();
    for (const worker of workers) {
      const current = worker.mcps ?? [];
      if (!current.includes(id)) continue;
      worker.mcps = current.filter((item) => item !== id);
      await this.workers.save(worker);
    }
  }

  /**
   * 校验并归一机器人勾选的 MCP id：去重、过滤非法值，全部必须存在。
   * 停用的配置允许保留在机器人选择中（初始化/派发时跳过）。
   */
  async normalizeWorkerIds(value: unknown): Promise<number[]> {
    if (!Array.isArray(value)) {
      throw new BadRequestException('MCP 服务选择格式错误');
    }
    const ids = [
      ...new Set(
        value
          .map((item) => Number(item))
          .filter((item) => Number.isInteger(item) && item > 0),
      ),
    ];
    if (!ids.length) return [];
    const rows = await this.servers.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    const known = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !known.has(id));
    if (missing.length) {
      throw new BadRequestException(`MCP 配置不存在：${missing.join('、')}`);
    }
    return ids;
  }

  /** 机器人 MCP 名称清单（Markdown 视图展示用） */
  async namesOf(ids: number[] | null | undefined): Promise<string[]> {
    if (!ids?.length) return [];
    const rows = await this.servers.find({
      where: { id: In(ids) },
      select: { id: true, name: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row.name]));
    return ids
      .map((id) => byId.get(id))
      .filter((name): name is string => !!name);
  }

  /**
   * 生成工位 .opencode/opencode.json 的完整 mcp.servers：
   * 平台 lita-work（机器人令牌鉴权）+ 机器人勾选且启用中的自定义 MCP。
   * 令牌只进入返回值，由调用方经 shell 落盘，不进日志与 Prompt。
   */
  async buildServersConfig(
    appUrl: string,
    workerToken: string,
    mcpIds: number[] | null | undefined,
  ): Promise<Record<string, OpencodeMcpServerConfig>> {
    const configs: Record<string, OpencodeMcpServerConfig> = {
      [LITA_WORK_SERVER_NAME]: {
        type: 'remote',
        url: `${appUrl.replace(/\/+$/, '')}/api/mcp/work`,
        oauth: false,
        headers: { 'X-Worker-Token': workerToken },
      },
    };
    const ids = [
      ...new Set((mcpIds ?? []).filter((id) => Number.isInteger(id) && id > 0)),
    ];
    if (!ids.length) return configs;
    const rows = await this.servers
      .createQueryBuilder('mcp')
      .addSelect('mcp.authSecret')
      .where('mcp.id IN (:...ids)', { ids })
      .andWhere('mcp.enabled = true')
      .getMany();
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      // 防止自定义配置覆盖平台固定服务
      if (row.name === LITA_WORK_SERVER_NAME) continue;
      configs[row.name] = buildOpencodeServerConfig(row, workerToken);
    }
    return configs;
  }

  /**
   * 平台侧连接测试（管理员触发）：
   * - remote 使用 Streamable HTTP 客户端；
   * - local 在平台宿主上拉起命令（真实运行环境是执行器宿主，结果仅作命令可用性参考）。
   * work-token 模式可传入机器人令牌（由管理页选择机器人借取），未传时匿名测试。
   */
  async test(
    id: number,
    workerToken: string | null,
  ): Promise<McpServerTestResult> {
    const row = await this.findOneWithSecret(id);
    const started = Date.now();
    let transport: StreamableHTTPClientTransport | StdioClientTransport;
    let note = '';
    if (row.type === McpServerType.REMOTE) {
      if (!row.url) throw new BadRequestException('该配置缺少服务地址');
      const headers = this.authHeadersForTest(row, workerToken);
      if (headers.note) note = `；${headers.note}`;
      transport = new StreamableHTTPClientTransport(new URL(row.url), {
        requestInit: headers.value ? { headers: headers.value } : undefined,
      });
    } else {
      if (!row.command?.length) {
        throw new BadRequestException('该配置缺少本地命令');
      }
      const environment = this.localEnvironmentForTest(row, workerToken);
      transport = new StdioClientTransport({
        command: row.command[0],
        args: row.command.slice(1),
        env: Object.keys(environment).length ? environment : undefined,
        stderr: 'ignore',
      });
    }
    const client = new Client({ name: 'lita-mcp-probe', version: '1.0.0' });
    try {
      await this.withTimeout(client.connect(transport));
      const listed = await this.withTimeout(client.listTools());
      const version = client.getServerVersion();
      const tools = (listed.tools ?? []).map((tool) => tool.name);
      return {
        status: 'connected',
        message: `连接成功${note}`,
        serverName: version?.name ?? null,
        serverVersion: version?.version ?? null,
        toolCount: tools.length,
        tools: tools.slice(0, 50),
        durationMs: Date.now() - started,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const authRejected =
        /\b(401|403)\b/.test(message) ||
        /unauthori[sz]ed|forbidden/i.test(message);
      this.logger.warn(`MCP 配置 #${id} 连接测试失败：${message}`);
      return {
        status: authRejected ? 'auth-rejected' : 'unreachable',
        message: authRejected
          ? `端点可达但鉴权被拒绝（HTTP 401/403）${note}`
          : `${message}${note}`,
        serverName: null,
        serverVersion: null,
        toolCount: null,
        tools: [],
        durationMs: Date.now() - started,
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /** 平台侧连接测试的请求头（env 模式优先取平台进程环境变量） */
  private authHeadersForTest(
    row: McpServer,
    workerToken: string | null,
  ): { value: Record<string, string> | null; note: string } {
    if (row.authMode === McpAuthMode.NONE) return { value: null, note: '' };
    if (row.authMode === McpAuthMode.FIXED) {
      return {
        value: row.authSecret
          ? {
              [row.authHeader]: applyAuthPrefix(row.authPrefix, row.authSecret),
            }
          : null,
        note: row.authSecret ? '' : '未配置固定令牌，已匿名测试',
      };
    }
    if (row.authMode === McpAuthMode.ENV) {
      const envValue = row.authSecret ? process.env[row.authSecret] : undefined;
      return {
        value: envValue
          ? { [row.authHeader]: applyAuthPrefix(row.authPrefix, envValue) }
          : null,
        note: envValue
          ? ''
          : `平台进程未找到环境变量 ${row.authSecret ?? '（未命名）'}，已匿名测试；真实值由执行器宿主环境提供`,
      };
    }
    return {
      value: workerToken
        ? { [row.authHeader]: applyAuthPrefix(row.authPrefix, workerToken) }
        : null,
      note: workerToken
        ? ''
        : '未选择机器人，无法借用 LITA_WORK_TOKEN，已匿名测试',
    };
  }

  /** 本地命令连接测试的环境变量（env 模式取平台进程环境变量） */
  private localEnvironmentForTest(
    row: McpServer,
    workerToken: string | null,
  ): Record<string, string> {
    if (row.authMode === McpAuthMode.NONE) return {};
    if (row.authMode === McpAuthMode.FIXED) {
      return row.authSecret
        ? { [row.authHeader]: applyAuthPrefix(row.authPrefix, row.authSecret) }
        : {};
    }
    if (row.authMode === McpAuthMode.ENV) {
      const envValue = row.authSecret ? process.env[row.authSecret] : undefined;
      return envValue ? { [row.authHeader]: envValue } : {};
    }
    return workerToken
      ? { [row.authHeader]: applyAuthPrefix(row.authPrefix, workerToken) }
      : {};
  }

  /** 读取含凭据原文的单条配置（仅服务端内部使用） */
  private async findOneWithSecret(id: number): Promise<McpServer> {
    const row = await this.servers
      .createQueryBuilder('mcp')
      .addSelect('mcp.authSecret')
      .where('mcp.id = :id', { id })
      .getOne();
    if (!row) throw new NotFoundException('MCP 配置不存在');
    return row;
  }

  /** 应用保存入参；编辑时未传字段保持原值 */
  private applyInput(
    row: McpServer,
    input: SaveMcpServerInput,
    previousAuthMode?: McpAuthMode,
  ): void {
    if (input.name !== undefined) row.name = input.name?.trim() ?? '';
    if (input.type !== undefined) row.type = parseType(input.type);
    if (input.url !== undefined) row.url = trimOrNull(input.url);
    if (input.command !== undefined) {
      row.command = normalizeCommand(input.command);
    }
    if (input.authMode !== undefined) {
      const nextMode = parseAuthMode(input.authMode);
      if (previousAuthMode !== undefined && nextMode !== previousAuthMode) {
        // 切换鉴权方式：旧凭据语义不兼容，必须先清空再要求重新填写
        row.authSecret = null;
      }
      row.authMode = nextMode;
    }
    if (input.authHeader !== undefined) {
      row.authHeader = input.authHeader?.trim() ?? '';
    }
    if (input.authPrefix !== undefined) {
      row.authPrefix = trimOrNull(input.authPrefix);
    }
    if (input.authSecret !== undefined) {
      const secret = trimOrNull(input.authSecret);
      if (secret) {
        row.authSecret = secret;
      } else if (previousAuthMode === undefined) {
        // 新建时空值即无凭据
        row.authSecret = null;
      }
      // 编辑且鉴权方式未变：留空表示保持原凭据
    }
    if (input.enabled !== undefined) row.enabled = input.enabled;
    if (input.remark !== undefined) row.remark = trimOrNull(input.remark);
  }

  /** 字段校验与按类型归一 */
  private assertFields(row: McpServer): void {
    if (!row.name) throw new BadRequestException('名称不能为空');
    if (!NAME_PATTERN.test(row.name)) {
      throw new BadRequestException(
        '名称仅支持字母、数字、- 和 _，且不超过 64 个字符（同时作为 opencode 服务标识）',
      );
    }
    if (row.name === LITA_WORK_SERVER_NAME) {
      throw new BadRequestException(
        `名称「${LITA_WORK_SERVER_NAME}」为平台固定 MCP 服务，请使用其它名称`,
      );
    }
    if (row.type === McpServerType.REMOTE) {
      row.command = null;
      if (!row.url)
        throw new BadRequestException('remote 类型必须填写服务地址');
      let url: URL;
      try {
        url = new URL(row.url);
      } catch {
        throw new BadRequestException('服务地址必须是合法的绝对 URL');
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new BadRequestException('服务地址仅支持 http/https');
      }
    } else {
      row.url = null;
      if (!row.command?.length) {
        throw new BadRequestException('local 类型必须填写本地命令');
      }
    }
    row.authHeader =
      row.authHeader?.trim() ||
      (row.type === McpServerType.LOCAL ? 'MCP_API_KEY' : 'Authorization');
    if (row.authMode === McpAuthMode.NONE) {
      row.authSecret = null;
      row.authPrefix = null;
    }
    if (row.authMode === McpAuthMode.WORK_TOKEN) {
      row.authSecret = null;
    }
    if (row.authMode === McpAuthMode.FIXED && !row.authSecret) {
      throw new BadRequestException('固定令牌模式必须填写令牌');
    }
    if (row.authMode === McpAuthMode.ENV) {
      if (!row.authSecret) {
        throw new BadRequestException('环境变量模式必须填写变量名');
      }
      if (!ENV_NAME_PATTERN.test(row.authSecret)) {
        throw new BadRequestException(
          '环境变量名仅支持字母、数字与下划线，且不能以数字开头',
        );
      }
    }
  }

  /** 名称唯一校验 */
  private async assertNameUnique(
    name: string,
    excludeId?: number,
  ): Promise<void> {
    const exists = await this.servers.findOne({ where: { name } });
    if (exists && exists.id !== excludeId) {
      throw new BadRequestException(`名称「${name}」已存在`);
    }
  }

  /** 实体 → 视图（固定令牌只返回是否已配置） */
  private toView(row: McpServer): McpServerView {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      url: row.url,
      command: row.command,
      authMode: row.authMode,
      authHeader: row.authHeader,
      authPrefix: row.authPrefix,
      hasSecret: row.authMode === McpAuthMode.FIXED && !!row.authSecret,
      envName: row.authMode === McpAuthMode.ENV ? row.authSecret : null,
      enabled: row.enabled,
      remark: row.remark,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 超时保护：连接测试不允许无限等待 */
  private withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error(`连接超时（超过 ${TEST_TIMEOUT_MS / 1000} 秒）`)),
        TEST_TIMEOUT_MS,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }
}

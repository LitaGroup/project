import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { McpCallLog } from './mcp-log.entity';

/** 单页上限 */
const PAGE_SIZE_MAX = 200;
const PAGE_SIZE_DEFAULT = 50;

export interface McpCallLogInput {
  userId: number;
  userName: string;
  workerId: number;
  workerName: string;
  sessionId: string;
  tool: string;
  status: string;
  durationMs: number;
  messageLength: number;
  contentLength?: number | null;
  error?: string | null;
}

/** MCP 调用审计：写入 + 管理端分页查询 */
@Injectable()
export class McpLogsService {
  private readonly logger = new Logger(McpLogsService.name);

  constructor(
    @InjectRepository(McpCallLog)
    private readonly logs: Repository<McpCallLog>,
  ) {}

  /** 审计写入失败只告警，不影响调用主流程 */
  async record(input: McpCallLogInput): Promise<void> {
    try {
      await this.logs.save(
        this.logs.create({
          userId: input.userId,
          userName: input.userName,
          workerId: input.workerId,
          workerName: input.workerName,
          sessionId: input.sessionId,
          tool: input.tool,
          status: input.status,
          durationMs: input.durationMs,
          messageLength: input.messageLength,
          contentLength: input.contentLength ?? null,
          error: input.error || null,
        }),
      );
    } catch (error) {
      this.logger.warn(`MCP 调用审计写入失败: ${(error as Error).message}`);
    }
  }

  /** 管理端列表：q 匹配 用户/机器人/会话，时间倒序 */
  async list(options: {
    q?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ items: McpCallLog[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Math.floor(options.page ?? 1));
    const pageSize = Math.min(
      PAGE_SIZE_MAX,
      Math.max(1, Math.floor(options.pageSize ?? PAGE_SIZE_DEFAULT)),
    );
    const qb = this.logs.createQueryBuilder('log');
    const q = options.q?.trim();
    if (q) {
      qb.andWhere(
        '(log.userName ILIKE :q OR log.workerName ILIKE :q OR log.sessionId ILIKE :q)',
        { q: `%${q}%` },
      );
    }
    const total = await qb.getCount();
    const items = await qb
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();
    return { items, total, page, pageSize };
  }
}

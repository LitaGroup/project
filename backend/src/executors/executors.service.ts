import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutorType } from '../common/enums';
import { Executor, ExecutorProvider } from './executor.entity';
import { OpencodeClient } from './opencode-client';
import { OpencodeEventHub } from './opencode-event-hub.service';

export interface CreateExecutorInput {
  name: string;
  ip: string;
  port: number;
  type?: ExecutorType;
  description?: string | null;
  token?: string | null;
}

export interface UpdateExecutorInput {
  name?: string;
  ip?: string;
  port?: number;
  type?: ExecutorType;
  description?: string | null;
  token?: string | null;
  enabled?: boolean;
}

@Injectable()
export class ExecutorsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ExecutorsService.name);

  constructor(
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly eventHub: OpencodeEventHub,
  ) {}

  /** 启动时立即健康检查一次并建立事件流订阅（否则重启后收不到执行器事件） */
  async onApplicationBootstrap(): Promise<void> {
    await this.checkAll();
    this.eventHub.sync(await this.findAll());
  }

  /** 全部执行器（按 id 升序） */
  findAll(): Promise<Executor[]> {
    return this.executors.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<Executor> {
    const executor = await this.executors.findOne({ where: { id } });
    if (!executor) throw new NotFoundException(`Executor ${id} not found`);
    return executor;
  }

  async create(input: CreateExecutorInput): Promise<Executor> {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('名称不能为空');
    this.assertEndpoint(input.ip, input.port);
    const exists = await this.executors.findOne({ where: { name } });
    if (exists) throw new BadRequestException(`名称「${name}」已存在`);
    const executor = await this.executors.save(
      this.executors.create({
        name,
        ip: input.ip.trim(),
        port: input.port,
        type: input.type ?? ExecutorType.OPENCODE,
        description: input.description?.trim() || null,
        token: input.token?.trim() || null,
      }),
    );
    // 新执行器立即做一次健康检查，让在线状态/默认目录马上可用
    await this.check(executor.id).catch(() => undefined);
    return this.findOne(executor.id);
  }

  async update(id: number, input: UpdateExecutorInput): Promise<Executor> {
    const executor = await this.findOne(id);
    if (input.name !== undefined && input.name.trim() !== executor.name) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('名称不能为空');
      const exists = await this.executors.findOne({ where: { name } });
      if (exists) throw new BadRequestException(`名称「${name}」已存在`);
      executor.name = name;
    }
    if (input.ip !== undefined) executor.ip = input.ip.trim();
    if (input.port !== undefined) executor.port = input.port;
    if (input.type !== undefined) executor.type = input.type;
    if (input.description !== undefined) {
      executor.description = input.description?.trim() || null;
    }
    if (input.token !== undefined) executor.token = input.token?.trim() || null;
    if (input.enabled !== undefined) executor.enabled = input.enabled;
    // 连接信息变更后立即复查在线状态
    await this.executors.save(executor);
    await this.check(id).catch(() => undefined);
    return this.findOne(id);
  }

  /** 删除执行器（仅删登记，不触达远端；已绑定的机器人由 workers 侧约束） */
  async remove(id: number): Promise<void> {
    const executor = await this.findOne(id);
    await this.executors.remove(executor);
    this.eventHub.sync(await this.findAll());
  }

  /**
   * 健康检查：GET /api/info 刷新在线状态与版本，顺带刷新默认工作目录。
   * 状态变化后同步事件中心订阅。
   */
  async check(id: number): Promise<Executor> {
    const executor = await this.findOne(id);
    const client = new OpencodeClient(executor);
    const wasOnline = executor.online;
    try {
      const info = await client.info();
      executor.online = true;
      executor.version = info.version ?? null;
      try {
        const location = await client.location();
        executor.defaultLocation = location.directory ?? null;
      } catch {
        // 目录接口失败不影响在线判定
      }
    } catch (e) {
      executor.online = false;
      executor.version = null;
      this.logger.debug(
        `执行器 #${id}（${executor.name}）离线: ${(e as Error).message}`,
      );
    }
    executor.lastCheckedAt = new Date();
    await this.executors.save(executor);
    if (executor.online !== wasOnline) {
      this.eventHub.sync(await this.findAll());
    }
    return executor;
  }

  /** 全量健康检查（定时）：仅启用中的执行器 */
  async checkAll(): Promise<void> {
    const executors = await this.executors.find({ where: { enabled: true } });
    for (const executor of executors) {
      await this.check(executor.id).catch(() => undefined);
    }
  }

  /**
   * 同步供应商与模型缓存：GET /api/provider（清单）+ GET /api/model（模型带 providerID），
   * 按 providerID 分组合并为 providersCache。
   */
  async syncProviders(id: number): Promise<Executor> {
    const executor = await this.findOne(id);
    const client = new OpencodeClient(executor);
    const [providers, models] = await Promise.all([
      client.providers(),
      client.models(),
    ]);
    const cache: ExecutorProvider[] = providers.map((p) => ({
      id: p.id,
      name: p.name ?? p.id,
      models: models
        .filter((m) => m.providerID === p.id)
        .map((m) => ({
          id: m.modelID ?? m.id,
          name: m.name ?? m.modelID ?? m.id,
        })),
    }));
    // 仅出现在 model 清单里的 provider 也保留（provider 清单可能只含已接入集成）
    const known = new Set(cache.map((p) => p.id));
    for (const m of models) {
      if (!known.has(m.providerID)) {
        known.add(m.providerID);
        cache.push({ id: m.providerID, name: m.providerID, models: [] });
      }
    }
    for (const p of cache) {
      if (p.models.length === 0) {
        p.models = models
          .filter((m) => m.providerID === p.id)
          .map((m) => ({
            id: m.modelID ?? m.id,
            name: m.name ?? m.modelID ?? m.id,
          }));
      }
    }
    executor.providersCache = cache;
    executor.providersSyncedAt = new Date();
    return this.executors.save(executor);
  }

  /** 每分钟健康检查（轻量 GET /api/info；在线状态变化才动事件流） */
  @Cron('0 * * * * *')
  async healthCheckCron(): Promise<void> {
    await this.checkAll();
  }

  /** 每日 06:00 刷新全部执行器的供应商缓存（失败仅告警） */
  @Cron('0 0 6 * * *')
  async providersRefreshCron(): Promise<void> {
    const executors = await this.executors.find({
      where: { enabled: true, online: true },
    });
    for (const executor of executors) {
      await this.syncProviders(executor.id).catch((e: Error) =>
        this.logger.warn(
          `执行器 #${executor.id}（${executor.name}）供应商缓存刷新失败: ${e.message}`,
        ),
      );
    }
  }

  private assertEndpoint(ip: string, port: number): void {
    if (!ip?.trim()) throw new BadRequestException('ip 不能为空');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('port 须为 1-65535 的整数');
    }
  }
}

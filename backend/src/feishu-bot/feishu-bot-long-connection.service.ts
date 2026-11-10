import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EventDispatcher,
  LoggerLevel,
  WSClient,
} from '@larksuiteoapi/node-sdk';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import { FeishuBotConfigService } from './feishu-bot-config.service';
import { FeishuBotChangeBus } from './feishu-bot-change.service';
import { FeishuBotEventService } from './feishu-bot-event.service';

/** 单个配置的 WS 长连接句柄 */
interface ActiveClient {
  configId: number;
  appId: string;
  ws: WSClient;
}

/**
 * 飞书长连接（WebSocket）入站通道：
 * 平台无公网回调地址时，由平台主动与飞书建立长连接接收事件。
 * 每个启用的飞书配置一条连接（按 appId + appSecret），
 * 事件进入后复用 FeishuBotEventService 的同一套消息/卡片处理逻辑。
 * 配置保存/删除后自动重建连接；每分钟兜底对账一次。
 */
@Injectable()
export class FeishuBotLongConnectionService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(FeishuBotLongConnectionService.name);
  private readonly clients = new Map<number, ActiveClient>();
  private readonly restarting = new Set<number>();
  private stopped = false;

  constructor(
    private readonly configs: FeishuBotConfigService,
    private readonly events: FeishuBotEventService,
    bus: FeishuBotChangeBus,
  ) {
    bus.changes$.subscribe((change) => {
      if (change === 'all') {
        void this.reconcileClients();
        return;
      }
      void this.restartClient(change);
    });
  }

  /** 启动时为全部启用配置建立长连接（不阻塞应用启动） */
  onApplicationBootstrap(): void {
    void this.reconcileClients();
  }

  /** 每分钟兜底对账：补齐缺失连接、清理停用配置 */
  @Cron('45 * * * * *')
  async reconcile(): Promise<void> {
    await this.reconcileClients();
  }

  /** 关闭全部长连接（应用退出时调用） */
  onModuleDestroy(): void {
    this.stopped = true;
    for (const client of this.clients.values()) {
      client.ws.close({ force: true });
    }
    this.clients.clear();
  }

  // ==== 连接管理 ====

  /** 全量对账：启用配置 ←→ 活动连接 */
  private async reconcileClients(): Promise<void> {
    if (this.stopped) return;
    try {
      const rows = await this.configs.listEnabledWithSecrets();
      const wanted = new Map(rows.map((row) => [row.id, row] as const));
      for (const row of rows) {
        const client = this.clients.get(row.id);
        if (!client) {
          this.startClient(row);
          continue;
        }
        if (client.appId !== row.appId) {
          await this.restartClient(row.id);
        }
      }
      for (const configId of Array.from(this.clients.keys())) {
        if (!wanted.has(configId)) this.stopClient(configId);
      }
    } catch (error) {
      this.logger.warn(`飞书长连接对账失败: ${(error as Error).message}`);
    }
  }

  /** 单配置重建：停用/删除则只停止，启用则重启 */
  private async restartClient(configId: number): Promise<void> {
    if (this.stopped) return;
    if (this.restarting.has(configId)) return;
    this.restarting.add(configId);
    try {
      this.stopClient(configId);
      const row = await this.configs.loadEnabledWithSecrets(configId);
      if (row) this.startClient(row);
    } catch (error) {
      this.logger.warn(
        `飞书长连接重建失败（config#${configId}）: ${(error as Error).message}`,
      );
    } finally {
      this.restarting.delete(configId);
    }
  }

  private startClient(row: FeishuBotConfig): void {
    let secrets: FeishuBotSecrets;
    try {
      secrets = this.configs.secretsOf(row);
    } catch (error) {
      this.logger.warn(
        `飞书长连接跳过 config#${row.id}：凭据不可用（${(error as Error).message}）`,
      );
      return;
    }
    const ws = new WSClient({
      appId: secrets.appId,
      appSecret: secrets.appSecret,
      loggerLevel: LoggerLevel.warn,
      autoReconnect: true,
      handshakeTimeoutMs: 15_000,
      source: 'lita-work',
      onReady: () => {
        this.logger.log(
          `飞书长连接已建立：${row.name ?? row.appId}（config#${row.id}）`,
        );
        void this.configs.markVerified(row.id);
      },
      onError: (error: Error) => {
        this.logger.warn(
          `飞书长连接错误（config#${row.id}）: ${error.message}`,
        );
        void this.configs.markError(row.id, error.message);
      },
      onReconnecting: () => {
        this.logger.warn(`飞书长连接断开，正在重连（config#${row.id}）`);
      },
      onReconnected: () => {
        this.logger.log(`飞书长连接已重连（config#${row.id}）`);
      },
    });
    const dispatcher = new EventDispatcher({}).register({
      'im.message.receive_v1': async (data: Record<string, unknown>) => {
        await this.events.dispatchLongConnectionMessage(row.id, secrets, data);
      },
      'im.chat.member.bot.added_v1': async (data: Record<string, unknown>) => {
        await this.events.dispatchLongConnectionBotMembership(
          row.id,
          secrets,
          'im.chat.member.bot.added_v1',
          data,
        );
      },
      'im.chat.member.bot.deleted_v1': async (
        data: Record<string, unknown>,
      ) => {
        await this.events.dispatchLongConnectionBotMembership(
          row.id,
          secrets,
          'im.chat.member.bot.deleted_v1',
          data,
        );
      },
      'card.action.trigger': async (data: Record<string, unknown>) =>
        this.events.dispatchLongConnectionCardAction(row.id, secrets, data),
    });
    this.clients.set(row.id, { configId: row.id, appId: row.appId, ws });
    void ws.start({ eventDispatcher: dispatcher }).catch((error: Error) => {
      this.logger.warn(
        `飞书长连接启动失败（config#${row.id}）: ${error.message}`,
      );
      void this.configs.markError(row.id, error.message);
      this.clients.delete(row.id);
    });
    this.logger.log(
      `飞书长连接启动中：${row.name ?? row.appId}（config#${row.id}）`,
    );
  }

  private stopClient(configId: number): void {
    const client = this.clients.get(configId);
    if (!client) return;
    try {
      client.ws.close({ force: true });
    } catch (error) {
      this.logger.warn(
        `飞书长连接关闭失败（config#${configId}）: ${(error as Error).message}`,
      );
    }
    this.clients.delete(configId);
    this.logger.log(`飞书长连接已关闭（config#${configId}）`);
  }
}

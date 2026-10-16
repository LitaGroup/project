import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthService } from './auth.service';

/** 每天凌晨 3 点同步一次飞书通讯录到本地用户表（6 段 crontab：秒 分 时 日 月 周） */
const SYNC_CRON = '0 0 3 * * *';

/**
 * 飞书通讯录用户全量同步：应用启动（首次部署）时同步一次 + 每日凌晨定时同步一次。
 * 同步为幂等 upsert，不影响已有用户的角色/登录态；失败仅告警不阻断启动。
 */
@Injectable()
export class UserSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserSyncService.name);
  /** 上一轮未结束时不重入（启动同步与定时同步可能重叠） */
  private running = false;

  constructor(private readonly auth: AuthService) {}

  /** 首次部署（应用启动）时同步一次；不阻塞启动，失败仅告警 */
  onApplicationBootstrap(): void {
    void this.syncOnce('启动同步');
  }

  /** 每日定时同步 */
  @Cron(SYNC_CRON)
  async scheduledSync(): Promise<void> {
    await this.syncOnce('定时同步');
  }

  /** 执行一轮同步（公开供手动触发）；已有同步在跑时直接跳过 */
  async syncOnce(source: string): Promise<void> {
    if (this.running) {
      this.logger.log(`跳过飞书用户${source}：上一轮同步尚未结束`);
      return;
    }
    this.running = true;
    try {
      const { total, created, updated } = await this.auth.syncFeishuUsers();
      this.logger.log(
        `飞书用户${source}完成：共 ${total} 人（新增 ${created}，更新 ${updated}）`,
      );
    } catch (e) {
      this.logger.warn(`飞书用户${source}失败: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}

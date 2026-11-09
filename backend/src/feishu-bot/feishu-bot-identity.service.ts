import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../auth/user.entity';
import type { FeishuBotConfig } from './feishu-bot-config.entity';
import { FeishuBotIdentity } from './feishu-bot-identity.entity';

/** 飞书事件中的发送者 id（open_id 应用维度 + union_id 跨应用备用） */
export interface FeishuSenderId {
  openId: string;
  unionId: string | null;
}

/**
 * 飞书用户身份解析：open_id 是应用维度的，独立应用的 open_id 与
 * users.feishuOpenId（OAuth 应用）不通用。
 * 解析顺序：缓存映射 → union_id 匹配 → 同应用 open_id（OAuth 登录落库）。
 * 未识别的用户不投递 Agent，回复绑定引导。
 */
@Injectable()
export class FeishuBotIdentityService {
  private readonly logger = new Logger(FeishuBotIdentityService.name);

  constructor(
    @InjectRepository(FeishuBotIdentity)
    private readonly identities: Repository<FeishuBotIdentity>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** 解析发送者对应的平台用户；未识别返回 null */
  async resolve(
    config: FeishuBotConfig,
    sender: FeishuSenderId,
  ): Promise<User | null> {
    const cached = await this.identities.findOne({
      where: { configId: config.id, openId: sender.openId },
    });
    if (cached) {
      const user = await this.users.findOne({ where: { id: cached.userId } });
      if (user) return user;
      await this.identities.delete({ id: cached.id });
      return null;
    }
    return this.matchAndBind(config, sender);
  }

  /** 查询某用户在指定应用下的 open_id（已通过私聊建立映射时可用） */
  async openIdFor(configId: number, userId: number): Promise<string | null> {
    const row = await this.identities.findOne({
      where: { configId, userId },
      order: { id: 'ASC' },
    });
    return row?.openId ?? null;
  }

  /** 首次解析：union_id / 同应用 open_id 匹配后写入缓存 */
  private async matchAndBind(
    config: FeishuBotConfig,
    sender: FeishuSenderId,
  ): Promise<User | null> {
    let user: User | null = null;
    if (sender.unionId) {
      user = await this.users.findOne({
        where: { unionId: sender.unionId },
      });
    }
    if (!user) {
      // 官方机器人常复用 OAuth 应用：open_id 直接命中登录用户
      user = await this.users.findOne({
        where: { feishuOpenId: sender.openId },
      });
    }
    if (!user || !user.enabled) return null;
    try {
      await this.identities.save(
        this.identities.create({
          configId: config.id,
          openId: sender.openId,
          unionId: sender.unionId,
          userId: user.id,
        }),
      );
      this.logger.log(
        `飞书用户绑定：config#${config.id} ${sender.openId} → ${user.name}(#${user.id})`,
      );
    } catch (error) {
      // 并发解析时唯一索引冲突可忽略
      this.logger.warn(
        `飞书用户绑定缓存写入失败（可忽略）: ${(error as Error).message}`,
      );
    }
    return user;
  }
}

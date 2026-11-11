import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRuntime } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { SYSTEM_FEEDBACK_HANDLER_WORKER_KEY } from '../workers/system-workers';
import type {
  FeishuBotConfigView,
  FeishuBotSecrets,
  SaveFeishuBotConfigInput,
} from './feishu-bot-config.entity';
import { FeishuBotConfig } from './feishu-bot-config.entity';
import { FeishuBotClientService } from './feishu-bot-client.service';
import { FeishuBotChangeBus } from './feishu-bot-change.service';
import { FeishuBotCryptoService } from './feishu-bot-crypto.service';
import { FeishuBotGroup } from './feishu-bot-group.entity';
import {
  FEISHU_BOT_DEFAULT_GROUP_POLICY,
  FEISHU_BOT_FEEDBACK_GROUP_POLICY,
  isFeishuBotGroupPolicy,
  type FeishuBotGroupPolicy,
} from './feishu-bot-group.entity';
import { FeishuBotGroupRecord } from './feishu-bot-group-record.entity';
import { FeishuBotIdentity } from './feishu-bot-identity.entity';

/** 官方机器人展示名 */
export const OFFICIAL_BOT_NAME = '平台官方机器人';

/**
 * 飞书机器人配置管理：官方机器人（唯一）+ 机器人绑定的独立飞书应用。
 * Secret 只写不读；保存后异步验证连接并把结果写回 lastVerifiedAt/lastError。
 */
@Injectable()
export class FeishuBotConfigService {
  private readonly logger = new Logger(FeishuBotConfigService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(FeishuBotConfig)
    private readonly configs: Repository<FeishuBotConfig>,
    @InjectRepository(FeishuBotIdentity)
    private readonly identities: Repository<FeishuBotIdentity>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(FeishuBotGroup)
    private readonly groups: Repository<FeishuBotGroup>,
    @InjectRepository(FeishuBotGroupRecord)
    private readonly groupRecords: Repository<FeishuBotGroupRecord>,
    private readonly crypto: FeishuBotCryptoService,
    private readonly client: FeishuBotClientService,
    private readonly changes: FeishuBotChangeBus,
    config: ConfigService,
  ) {
    this.appUrl = (
      config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/+$/, '');
  }

  /** 管理页清单：官方机器人 + 全部已绑定机器人的配置 */
  async list(): Promise<FeishuBotConfigView[]> {
    const rows = await this.listAllWithSecrets();
    return rows.map((row) => this.toView(row));
  }

  /** 绑定了独立飞书应用的机器人 id 集合（机器人列表角标用） */
  async boundWorkerIds(): Promise<Set<number>> {
    const rows = await this.configs.find({
      where: { kind: 'worker' },
      select: { workerId: true },
    });
    return new Set(
      rows
        .map((row) => row.workerId)
        .filter((id): id is number => typeof id === 'number'),
    );
  }

  /** 机器人已启用且绑定的飞书应用配置（项目沟通群拉机器人用） */
  async findEnabledWorkerConfig(
    workerId: number,
  ): Promise<FeishuBotConfig | null> {
    return this.configs.findOne({
      where: { workerId, kind: 'worker', enabled: true },
    });
  }

  /** 配置/更新平台官方机器人（全平台唯一） */
  async saveOfficial(
    input: SaveFeishuBotConfigInput,
  ): Promise<FeishuBotConfigView> {
    let row = await this.configs.findOne({ where: { kind: 'official' } });
    row = await this.applySave(row, OFFICIAL_BOT_NAME, null, input);
    return this.toView(row);
  }

  /** 配置/更新机器人绑定的独立飞书应用 */
  async saveForWorker(
    workerId: number,
    input: SaveFeishuBotConfigInput,
  ): Promise<FeishuBotConfigView> {
    const worker = await this.workers.findOne({ where: { id: workerId } });
    if (!worker) throw new NotFoundException(`机器人 ${workerId} 不存在`);
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('真人机器人不支持绑定飞书应用');
    }
    if (worker.id < 1000) {
      // 例外：「系统-反馈处理」需要绑定飞书应用进入用户反馈群采集话题反馈
      if (worker.systemKey !== SYSTEM_FEEDBACK_HANDLER_WORKER_KEY) {
        throw new BadRequestException('系统机器人不支持绑定飞书应用');
      }
    }
    let row = await this.configs.findOne({ where: { workerId } });
    row = await this.applySave(row, worker.name, workerId, input);
    return this.toView(row);
  }

  /** 删除配置（同时清除该应用的用户身份映射与群策略/记录） */
  async remove(configId: number): Promise<void> {
    const row = await this.configs.findOne({ where: { id: configId } });
    if (!row) throw new NotFoundException('飞书配置不存在');
    await this.configs.delete({ id: configId });
    await this.identities.delete({ configId });
    await this.groupRecords.delete({ configId });
    await this.groups.delete({ configId });
    this.client.invalidate(configId);
    this.changes.configChanged(configId);
  }

  /** 长连接已建立：记录验证成功时间并清空上次错误 */
  async markVerified(configId: number): Promise<void> {
    await this.configs
      .update({ id: configId }, { lastVerifiedAt: new Date(), lastError: null })
      .catch(() => {});
  }

  /** 记录机器人自身 open_id（群内 @机器人识别用；仅在成功读取后调用） */
  async saveBotOpenId(configId: number, botOpenId: string): Promise<void> {
    if (!botOpenId) return;
    await this.configs.update({ id: configId }, { botOpenId });
  }

  /** 长连接错误：写入 lastError 供管理页展示 */
  async markError(configId: number, message: string): Promise<void> {
    await this.configs
      .update({ id: configId }, { lastError: message.slice(0, 2000) })
      .catch(() => {});
  }

  /** 连接验证：获取 token 并读取机器人信息，结果写回配置 */
  async test(configId: number): Promise<FeishuBotConfigView> {
    const row = await this.loadWithSecrets(configId);
    const secrets = this.secretsOf(row);
    try {
      const bot = await this.client.verify(secrets);
      await this.configs.update(
        { id: row.id },
        {
          lastVerifiedAt: new Date(),
          lastError: null,
          ...(bot?.openId ? { botOpenId: bot.openId } : {}),
        },
      );
    } catch (error) {
      const message = (error as Error).message;
      await this.configs.update({ id: row.id }, { lastError: message });
      throw new BadRequestException(`连接验证失败：${message}`);
    }
    // 重新按含密文列加载：toView 需要密文字段判断「已配置」状态
    const fresh = await this.loadWithSecrets(configId);
    return this.toView(fresh);
  }

  /** 配置绑定的机器人是否为「系统-反馈处理」（收录群配置仅对这一份飞书配置开放） */
  async isFeedbackCollector(configId: number): Promise<boolean> {
    const row = await this.configs.findOne({ where: { id: configId } });
    if (!row || row.kind !== 'worker' || row.workerId === null) return false;
    const worker = await this.workers.findOne({
      where: { id: row.workerId },
      select: { systemKey: true },
    });
    return worker?.systemKey === SYSTEM_FEEDBACK_HANDLER_WORKER_KEY;
  }

  /** 外部群默认答复策略（单群策略在其之上覆盖；缺省仅被 @ 后回复） */
  async groupDefaultPolicy(configId: number): Promise<FeishuBotGroupPolicy> {
    const row = await this.loadWithSecrets(configId);
    const value = row.policy?.groupDefault;
    return isFeishuBotGroupPolicy(value)
      ? value
      : FEISHU_BOT_DEFAULT_GROUP_POLICY;
  }

  /** 保存外部群默认答复策略（写入 config.policy.groupDefault）；反馈采集策略不可作为默认策略 */
  async saveGroupDefaultPolicy(
    configId: number,
    policy: FeishuBotGroupPolicy,
  ): Promise<FeishuBotGroupPolicy> {
    if (!isFeishuBotGroupPolicy(policy)) {
      throw new BadRequestException('未知的群聊答复策略');
    }
    if (policy === FEISHU_BOT_FEEDBACK_GROUP_POLICY) {
      throw new BadRequestException(
        '反馈采集策略仅能对单个群开启，不支持设为默认策略',
      );
    }
    const row = await this.loadWithSecrets(configId);
    const next = { ...(row.policy ?? {}), groupDefault: policy };
    await this.configs.update({ id: row.id }, { policy: next });
    return policy;
  }

  // ==== 内部读取（服务端专用） ====

  /** 按配置 id 加载（含密文列），供回调/发送使用 */
  async loadWithSecrets(configId: number): Promise<FeishuBotConfig> {
    return this.loadBy({ id: configId });
  }

  /** 加载启用中的官方机器人配置（含密文列）；未配置返回 null */
  async loadEnabledOfficial(): Promise<FeishuBotConfig | null> {
    try {
      const row = await this.loadBy({ kind: 'official', enabled: true });
      return row;
    } catch {
      return null;
    }
  }

  /** 全部配置（含密文列，仅服务端内部用于状态判断，禁止出参） */
  private async listAllWithSecrets(): Promise<FeishuBotConfig[]> {
    return this.configs
      .createQueryBuilder('config')
      .addSelect([
        'config.secretCiphertext',
        'config.secretIv',
        'config.secretAuthTag',
        'config.keyVersion',
        'config.verificationTokenCiphertext',
        'config.verificationTokenIv',
        'config.verificationTokenAuthTag',
        'config.encryptKeyCiphertext',
        'config.encryptKeyIv',
        'config.encryptKeyAuthTag',
      ])
      .orderBy('config.kind', 'ASC')
      .addOrderBy('config.id', 'ASC')
      .getMany();
  }

  /** 全部启用配置（含密文列），长连接启动/对账用 */
  async listEnabledWithSecrets(): Promise<FeishuBotConfig[]> {
    return this.configs
      .createQueryBuilder('config')
      .addSelect([
        'config.secretCiphertext',
        'config.secretIv',
        'config.secretAuthTag',
        'config.keyVersion',
        'config.verificationTokenCiphertext',
        'config.verificationTokenIv',
        'config.verificationTokenAuthTag',
        'config.encryptKeyCiphertext',
        'config.encryptKeyIv',
        'config.encryptKeyAuthTag',
      ])
      .where('config.enabled = :enabled', { enabled: true })
      .orderBy('config.id', 'ASC')
      .getMany();
  }

  /** 单个启用配置（含密文列）；未启用/不存在返回 null */
  async loadEnabledWithSecrets(
    configId: number,
  ): Promise<FeishuBotConfig | null> {
    const row = await this.configs
      .createQueryBuilder('config')
      .addSelect([
        'config.secretCiphertext',
        'config.secretIv',
        'config.secretAuthTag',
        'config.keyVersion',
        'config.verificationTokenCiphertext',
        'config.verificationTokenIv',
        'config.verificationTokenAuthTag',
        'config.encryptKeyCiphertext',
        'config.encryptKeyIv',
        'config.encryptKeyAuthTag',
      ])
      .where('config.id = :configId AND config.enabled = :enabled', {
        configId,
        enabled: true,
      })
      .getOne();
    return row ?? null;
  }

  /** 解密为可用的凭据集合（仅服务端内部流转） */
  secretsOf(row: FeishuBotConfig): FeishuBotSecrets {
    return {
      appId: row.appId,
      appSecret: this.crypto.decrypt({
        ciphertext: row.secretCiphertext,
        iv: row.secretIv,
        authTag: row.secretAuthTag,
      }),
      verificationToken: row.verificationTokenCiphertext
        ? this.crypto.decrypt({
            ciphertext: row.verificationTokenCiphertext,
            iv: row.verificationTokenIv,
            authTag: row.verificationTokenAuthTag,
          })
        : null,
      encryptKey: row.encryptKeyCiphertext
        ? this.crypto.decrypt({
            ciphertext: row.encryptKeyCiphertext,
            iv: row.encryptKeyIv,
            authTag: row.encryptKeyAuthTag,
          })
        : null,
    };
  }

  /** 读取事件加密 Key（未配置返回 null） */
  encryptKeyOf(row: FeishuBotConfig): string | null {
    if (!row.encryptKeyCiphertext) return null;
    return this.crypto.decrypt({
      ciphertext: row.encryptKeyCiphertext,
      iv: row.encryptKeyIv,
      authTag: row.encryptKeyAuthTag,
    });
  }

  /** 读取 Verification Token（未配置返回 null） */
  verificationTokenOf(row: FeishuBotConfig): string | null {
    if (!row.verificationTokenCiphertext) return null;
    return this.crypto.decrypt({
      ciphertext: row.verificationTokenCiphertext,
      iv: row.verificationTokenIv,
      authTag: row.verificationTokenAuthTag,
    });
  }

  // ==== 内部 ====

  private async loadBy(
    where:
      Pick<FeishuBotConfig, 'id'> | Pick<FeishuBotConfig, 'kind' | 'enabled'>,
  ): Promise<FeishuBotConfig> {
    const qb = this.configs
      .createQueryBuilder('config')
      .addSelect([
        'config.secretCiphertext',
        'config.secretIv',
        'config.secretAuthTag',
        'config.keyVersion',
        'config.verificationTokenCiphertext',
        'config.verificationTokenIv',
        'config.verificationTokenAuthTag',
        'config.encryptKeyCiphertext',
        'config.encryptKeyIv',
        'config.encryptKeyAuthTag',
      ])
      .where(this.whereOf(where), where);
    const row = await qb.getOne();
    if (!row) throw new NotFoundException('飞书配置不存在');
    return row;
  }

  private whereOf(where: Record<string, unknown>): string {
    return Object.keys(where)
      .map((key) => `config.${key} = :${key}`)
      .join(' AND ');
  }

  /** 新建/更新配置：保存前校验 APP ID/Secret 有效性，Secret 留空则沿用旧值 */
  private async applySave(
    existing: FeishuBotConfig | null,
    name: string,
    workerId: number | null,
    input: SaveFeishuBotConfigInput,
  ): Promise<FeishuBotConfig> {
    const appId = input.appId?.trim();
    if (!existing && !appId) {
      throw new BadRequestException('APP ID 不能为空');
    }
    if (!existing && !input.appSecret?.trim()) {
      throw new BadRequestException('首次配置必须填写 APP Secret');
    }
    if (!existing && !this.crypto.available) {
      throw new BadRequestException(
        '未配置 FEISHU_BOT_MASTER_KEY，不能保存飞书凭据',
      );
    }

    // 保存前强制校验凭据：更新时 Secret 留空则解密既有 Secret 一起验证
    const existingSecrets = existing
      ? this.secretsOf(await this.loadWithSecrets(existing.id))
      : null;
    const effectiveAppId = appId || existing?.appId || '';
    const effectiveSecret =
      input.appSecret?.trim() || existingSecrets?.appSecret || '';
    if (!effectiveAppId || !effectiveSecret) {
      throw new BadRequestException('APP ID 与 APP Secret 不能为空');
    }
    try {
      await this.client.validateCredentials(effectiveAppId, effectiveSecret);
    } catch (error) {
      throw new BadRequestException(
        `APP ID 或 APP Secret 无效：${(error as Error).message}`,
      );
    }
    // 尽力读取机器人自身 open_id（群内 @机器人识别用）；读取失败不阻断保存
    const bot = await this.client
      .verify({
        appId: effectiveAppId,
        appSecret: effectiveSecret,
        verificationToken: null,
        encryptKey: null,
      })
      .catch(() => null);

    const patch: Partial<FeishuBotConfig> = {
      name,
      lastVerifiedAt: new Date(),
      lastError: null,
      ...(bot?.openId ? { botOpenId: bot.openId } : {}),
      ...(workerId !== null ? { workerId } : {}),
      ...(appId ? { appId } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    };
    if (input.appSecret?.trim()) {
      const encrypted = this.crypto.encrypt(input.appSecret.trim());
      patch.secretCiphertext = encrypted.ciphertext;
      patch.secretIv = encrypted.iv;
      patch.secretAuthTag = encrypted.authTag;
      patch.keyVersion = encrypted.keyVersion;
    }
    if (input.verificationToken?.trim()) {
      const encrypted = this.crypto.encrypt(input.verificationToken.trim());
      patch.verificationTokenCiphertext = encrypted.ciphertext;
      patch.verificationTokenIv = encrypted.iv;
      patch.verificationTokenAuthTag = encrypted.authTag;
    }
    if (input.encryptKey?.trim()) {
      const encrypted = this.crypto.encrypt(input.encryptKey.trim());
      patch.encryptKeyCiphertext = encrypted.ciphertext;
      patch.encryptKeyIv = encrypted.iv;
      patch.encryptKeyAuthTag = encrypted.authTag;
    }

    let row: FeishuBotConfig;
    if (existing) {
      await this.configs.update({ id: existing.id }, patch as never);
      this.client.invalidate(existing.id);
      row = await this.loadWithSecrets(existing.id);
    } else {
      const created = this.configs.create({
        kind: workerId === null ? 'official' : 'worker',
        ...patch,
        boundAt: new Date(),
      } as Partial<FeishuBotConfig>);
      try {
        row = await this.loadWithSecrets((await this.configs.save(created)).id);
      } catch (error) {
        const message = (error as Error).message;
        if (
          message.includes('appId') ||
          message.includes('UQ_feishu_bot_configs_appId')
        ) {
          throw new BadRequestException('该 APP ID 已被其他飞书配置使用');
        }
        if (
          message.includes('workerId') ||
          message.includes('UQ_feishu_bot_configs_workerId')
        ) {
          throw new BadRequestException('该机器人已绑定飞书配置');
        }
        throw error;
      }
    }

    // 凭据已在保存前校验通过：记录验证时间，通知长连接服务重建 WS 客户端
    this.changes.configChanged(row.id);
    return row;
  }

  private toView(row: FeishuBotConfig): FeishuBotConfigView {
    return {
      id: row.id,
      kind: row.kind,
      workerId: row.workerId,
      name: row.name,
      appId: row.appId,
      enabled: row.enabled,
      secretConfigured: Boolean(row.secretCiphertext),
      verificationTokenConfigured: Boolean(row.verificationTokenCiphertext),
      encryptKeyConfigured: Boolean(row.encryptKeyCiphertext),
      callbackUrl: `${this.appUrl}/api/feishu-bot/callback/${row.id}`,
      boundAt: row.boundAt?.toISOString() ?? null,
      lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      lastError: row.lastError,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

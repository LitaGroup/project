import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { IsNull, LessThan, Repository } from 'typeorm';
import { AuthService } from '../auth/auth.service';
import { User } from '../auth/user.entity';
import {
  SaveSsoClientInput,
  SsoClient,
  SsoClientCreated,
  SsoClientView,
} from './sso-client.entity';
import { SsoCode } from './sso-code.entity';

/** 授权码有效期：10 分钟且一次性 */
const CODE_TTL_MS = 10 * 60 * 1000;
/** access_token 有效期：2 小时，过期后重走授权码（平台会话 7 天内静默免登） */
const ACCESS_TOKEN_TTL_SECONDS = 2 * 60 * 60;
/** 登录衔接 Cookie 有效期：10 分钟 */
const CONTEXT_COOKIE_TTL_MS = 10 * 60 * 1000;
/** 回调地址白名单上限 */
const MAX_REDIRECT_URIS = 20;

/** OAuth2 端点错误：token / userinfo 以标准错误 JSON 响应 */
export class SsoOAuthError extends Error {
  constructor(
    /** OAuth2 标准错误码（invalid_client / invalid_grant / invalid_request / unsupported_grant_type / invalid_token） */
    readonly error: string,
    readonly description: string,
  ) {
    super(description);
  }
}

/** userinfo 返回的用户信息（基础信息 + 飞书标识） */
export interface SsoUserInfo {
  id: number;
  name: string;
  avatarUrl: string | null;
  email: string | null;
  department: string | null;
  feishuOpenId: string;
  feishuUnionId: string | null;
}

/** token 端点响应 */
export interface SsoTokenResult {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
}

/**
 * 单点登录（OAuth2 授权码 IdP）：
 * - 接入方管理：clientId / clientSecret（只写不回显）与回调地址白名单；
 * - authorize：已登录签发一次性授权码 302 回跳；未登录暂存上下文走飞书登录后续发；
 * - token：授权码 + client 凭证换短效 access_token（独立 JWT，与平台会话令牌互不通用）；
 * - userinfo：Bearer access_token 换用户信息。
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(SsoClient)
    private readonly clientsRepo: Repository<SsoClient>,
    @InjectRepository(SsoCode)
    private readonly codesRepo: Repository<SsoCode>,
  ) {}

  // ---- 接入方管理（管理区） ----

  /** 接入方列表（密钥不回显，仅返回是否已配置） */
  async list(): Promise<SsoClientView[]> {
    const rows = await this.clientsRepo
      .createQueryBuilder('client')
      .addSelect('client.clientSecret')
      .orderBy('client.id', 'DESC')
      .getMany();
    return rows.map((row) => this.toView(row));
  }

  /** 新建接入方：生成 clientId / clientSecret，密钥仅在本次响应中返回一次 */
  async create(input: SaveSsoClientInput): Promise<SsoClientCreated> {
    const name = this.normalizeName(input.name);
    const redirectUris = this.normalizeRedirectUris(input.redirectUris);
    const clientId = `sso_${randomBytes(12).toString('hex')}`;
    const clientSecret = this.generateSecret();
    const saved = await this.clientsRepo.save(
      this.clientsRepo.create({
        name,
        clientId,
        clientSecret,
        redirectUris,
        enabled: input.enabled ?? true,
        remark: input.remark?.trim() || null,
      }),
    );
    this.logger.log(`SSO 接入方新建: ${name} (${clientId})`);
    return { ...this.toView({ ...saved, clientSecret }), clientSecret };
  }

  /** 编辑接入方：名称 / 回调地址 / 启用 / 备注；密钥不受影响 */
  async update(id: number, input: SaveSsoClientInput): Promise<SsoClientView> {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) throw new BadRequestException('接入方不存在');
    if (input.name !== undefined) client.name = this.normalizeName(input.name);
    if (input.redirectUris !== undefined) {
      client.redirectUris = this.normalizeRedirectUris(input.redirectUris);
    }
    if (input.enabled !== undefined) client.enabled = input.enabled;
    if (input.remark !== undefined)
      client.remark = input.remark?.trim() || null;
    const saved = await this.clientsRepo.save(client);
    return this.toView(saved);
  }

  /** 重置密钥：旧密钥立即失效，新密钥仅在本次响应中返回一次 */
  async resetSecret(id: number): Promise<{ clientSecret: string }> {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) throw new BadRequestException('接入方不存在');
    const clientSecret = this.generateSecret();
    await this.clientsRepo.update({ id }, { clientSecret });
    this.logger.log(`SSO 接入方密钥重置: ${client.name} (${client.clientId})`);
    return { clientSecret };
  }

  /** 删除接入方：应用层同时清理其授权码记录（无库级联） */
  async remove(id: number): Promise<{ ok: true }> {
    const client = await this.clientsRepo.findOne({ where: { id } });
    if (!client) throw new BadRequestException('接入方不存在');
    await this.codesRepo.delete({ clientId: client.clientId });
    await this.clientsRepo.remove(client);
    return { ok: true };
  }

  // ---- authorize ----

  /**
   * 校验接入方与回调地址（authorize 未登录时先快速失败，登录后再走完整发码流程）。
   * client 无效/停用或 redirect_uri 未登记时抛错，绝不回跳（防开放重定向）。
   */
  async assertAuthorizeClient(
    clientId: string,
    redirectUri: string,
  ): Promise<void> {
    const client = await this.clientsRepo.findOne({ where: { clientId } });
    if (!client || !client.enabled) {
      throw new BadRequestException('无效的 client_id，或接入方应用已停用');
    }
    if (!this.isRegisteredRedirect(client, redirectUri)) {
      throw new BadRequestException(
        'redirect_uri 未登记：回调地址必须与接入方登记的白名单精确匹配',
      );
    }
  }

  /** 为已登录用户签发一次性授权码并构造回跳地址 */
  async buildAuthorizeRedirect(
    user: User,
    params: { clientId: string; redirectUri: string; state: string | null },
  ): Promise<string> {
    await this.assertAuthorizeClient(params.clientId, params.redirectUri);
    const code = await this.issueCode(
      params.clientId,
      user.id,
      params.redirectUri,
    );
    const search = new URLSearchParams({ code });
    if (params.state) search.set('state', params.state);
    return appendQuery(params.redirectUri, search);
  }

  /** 登录衔接 Cookie 配置（HttpOnly/SameSite=Lax，10 分钟短效） */
  contextCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: CONTEXT_COOKIE_TTL_MS,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
    };
  }

  // ---- token ----

  /**
   * 授权码换 access_token：校验 grant_type、client 凭证、code 有效性与三元组绑定。
   * access_token 为独立 JWT（typ=sso_access、aud=clientId），与平台会话令牌互不通用。
   */
  async exchangeToken(input: {
    grantType: string;
    clientId: string | undefined;
    clientSecret: string | undefined;
    code: string;
    redirectUri: string;
  }): Promise<SsoTokenResult> {
    if (input.grantType !== 'authorization_code') {
      throw new SsoOAuthError(
        'unsupported_grant_type',
        '仅支持 grant_type=authorization_code',
      );
    }
    if (!input.code) {
      throw new SsoOAuthError('invalid_request', '缺少 code');
    }
    if (!input.redirectUri) {
      throw new SsoOAuthError('invalid_request', '缺少 redirect_uri');
    }
    if (!input.clientId || !input.clientSecret) {
      throw new SsoOAuthError(
        'invalid_client',
        '缺少 client_id 或 client_secret',
      );
    }
    const client = await this.findClientWithSecret(input.clientId);
    if (!client || !client.enabled) {
      throw new SsoOAuthError('invalid_client', 'client 无效或已停用');
    }
    if (!this.constantEquals(input.clientSecret, client.clientSecret)) {
      throw new SsoOAuthError('invalid_client', 'client_secret 不匹配');
    }
    const row = await this.codesRepo.findOne({
      where: { code: input.code, clientId: input.clientId },
    });
    if (!row || row.redirectUri !== input.redirectUri) {
      throw new SsoOAuthError(
        'invalid_grant',
        '授权码无效或 redirect_uri 与发码时不一致',
      );
    }
    // 条件更新保证一次性：并发消费只有一方成功
    const consumed = await this.codesRepo.update(
      { id: row.id, usedAt: IsNull() },
      { usedAt: new Date() },
    );
    if (!consumed.affected) {
      throw new SsoOAuthError('invalid_grant', '授权码已使用');
    }
    if (row.expiresAt.getTime() < Date.now()) {
      throw new SsoOAuthError('invalid_grant', '授权码已过期');
    }
    const user = await this.authService.getUserById(row.userId);
    if (!user) {
      throw new SsoOAuthError('invalid_grant', '用户不存在或已禁用');
    }
    return {
      access_token: this.signAccessToken(user.id, input.clientId),
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  // ---- userinfo ----

  /** Bearer access_token 换用户信息；用户被禁用或令牌失效即 401 */
  async getUserInfoByAccessToken(token: string): Promise<SsoUserInfo> {
    let payload: jwt.JwtPayload;
    try {
      payload = jwt.verify(token, this.ssoJwtSecret()) as jwt.JwtPayload;
    } catch {
      throw new SsoOAuthError('invalid_token', 'access_token 无效或已过期');
    }
    if (payload.typ !== 'sso_access') {
      throw new SsoOAuthError('invalid_token', '令牌类型不正确');
    }
    const user = await this.authService.getUserById(Number(payload.sub));
    if (!user) {
      throw new SsoOAuthError('invalid_token', '用户不存在或已禁用');
    }
    return {
      id: user.id,
      name: user.name,
      avatarUrl: user.avatarUrl,
      email: user.email,
      department: user.department,
      feishuOpenId: user.feishuOpenId,
      feishuUnionId: user.unionId,
    };
  }

  // ---- 内部 ----

  private toView(client: SsoClient): SsoClientView {
    return {
      id: client.id,
      name: client.name,
      clientId: client.clientId,
      redirectUris: client.redirectUris,
      enabled: client.enabled,
      remark: client.remark,
      hasSecret: !!client.clientSecret,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  /** select:false 列需要显式查询（凭证比对用） */
  private findClientWithSecret(clientId: string): Promise<SsoClient | null> {
    return this.clientsRepo
      .createQueryBuilder('client')
      .addSelect('client.clientSecret')
      .where('client.clientId = :clientId', { clientId })
      .getOne();
  }

  /** 回调地址精确匹配（双方都经 URL 归一化后比对） */
  private isRegisteredRedirect(
    client: SsoClient,
    redirectUri: string,
  ): boolean {
    try {
      const normalized = new URL(redirectUri).toString();
      return client.redirectUris.includes(normalized);
    } catch {
      return false;
    }
  }

  /** 签发授权码；顺带清理一天前的过期码控制表体积 */
  private async issueCode(
    clientId: string,
    userId: number,
    redirectUri: string,
  ): Promise<string> {
    await this.codesRepo.delete({
      expiresAt: LessThan(new Date(Date.now() - 24 * 60 * 60 * 1000)),
    });
    const code = randomBytes(24).toString('hex');
    await this.codesRepo.save(
      this.codesRepo.create({
        code,
        clientId,
        userId,
        redirectUri,
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      }),
    );
    return code;
  }

  private signAccessToken(userId: number, clientId: string): string {
    return jwt.sign({ typ: 'sso_access', aud: clientId }, this.ssoJwtSecret(), {
      subject: String(userId),
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }

  /**
   * SSO access_token 签名密钥：优先 SSO_JWT_SECRET；
   * 未配置时从平台会话密钥单向派生独立密钥，保证两类令牌不可互相验证。
   */
  private ssoJwtSecret(): string {
    const configured = this.config.get<string>('SSO_JWT_SECRET')?.trim();
    if (configured) return configured;
    const base =
      this.config.get<string>('AUTH_JWT_SECRET') || 'pmp-dev-insecure-secret';
    return createHash('sha256').update(`sso-access:${base}`).digest('hex');
  }

  /** 常量时间比对密钥：先 SHA-256 再比较，避免长度差异与提前返回泄露信息 */
  private constantEquals(provided: string, expected: string | undefined) {
    if (!expected) return false;
    const a = createHash('sha256').update(provided).digest();
    const b = createHash('sha256').update(expected).digest();
    return timingSafeEqual(a, b);
  }

  private generateSecret(): string {
    return randomBytes(24).toString('hex');
  }

  private normalizeName(name: string | undefined): string {
    const trimmed = name?.trim();
    if (!trimmed) throw new BadRequestException('名称不能为空');
    if (trimmed.length > 100)
      throw new BadRequestException('名称不能超过 100 字');
    return trimmed;
  }

  /** 回调地址校验与归一化：http/https 绝对地址、去重、最多 20 条 */
  private normalizeRedirectUris(input: string[] | undefined): string[] {
    const list = Array.isArray(input) ? input : [];
    const seen = new Set<string>();
    for (const item of list) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new BadRequestException('回调地址不能为空');
      }
      let parsed: URL;
      try {
        parsed = new URL(item.trim());
      } catch {
        throw new BadRequestException(`回调地址不是合法 URL：${item.trim()}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new BadRequestException('回调地址仅支持 http/https 协议');
      }
      seen.add(parsed.toString());
    }
    if (seen.size === 0) {
      throw new BadRequestException('至少登记一个回调地址');
    }
    if (seen.size > MAX_REDIRECT_URIS) {
      throw new BadRequestException(`回调地址最多 ${MAX_REDIRECT_URIS} 个`);
    }
    return [...seen];
  }
}

/** 在已有 URL 上追加查询参数（兼容回调地址自带 query 的情况） */
function appendQuery(uri: string, params: URLSearchParams): string {
  const qs = params.toString();
  if (!qs) return uri;
  return uri + (uri.includes('?') ? '&' : '?') + qs;
}

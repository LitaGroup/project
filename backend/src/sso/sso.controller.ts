import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { AUTH_COOKIE, AuthService } from '../auth/auth.service';
import type { User } from '../auth/user.entity';
import { UserRole } from '../common/enums';
import { readCookie } from '../auth/cookies';
import { Public } from '../auth/public.decorator';
import type {
  SaveSsoClientInput,
  SsoClientCreated,
  SsoClientView,
} from './sso-client.entity';
import { SSO_CONTEXT_COOKIE } from './sso.constants';
import { SsoOAuthError, SsoService } from './sso.service';

/** 管理端点统一要求管理员 */
function assertAdmin(user: User | undefined): void {
  if (user?.role !== UserRole.ADMIN) {
    throw new ForbiddenException('仅管理员可管理 SSO 接入方');
  }
}

/** Express query/body 值取第一个（重复参数时取首值） */
function asString(value: unknown): string {
  if (Array.isArray(value)) return asString(value[0]);
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return '';
}

/**
 * 单点登录（OAuth2 授权码 IdP）：
 * 协议端点 authorize / token / userinfo 标记 @Public（登录流程与服务端调用，
 * 各自自行鉴权：会话 Cookie、client 凭证、Bearer access_token）；
 * 管理端点 clients 走全局登录 Guard 并要求管理员。
 */
@Controller('sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  // ---- 协议端点 ----

  /**
   * 授权端点：
   * - 已登录：签发一次性授权码，302 {redirect_uri}?code&state；
   * - 未登录：暂存上下文 Cookie 后 302 飞书登录，成功回跳本端点续发；
   * - client 无效或 redirect_uri 未登记时直接 400，不回跳（防开放重定向）。
   */
  @Public()
  @Get('authorize')
  async authorize(
    @Req() req: Request,
    @Res() res: Response,
    @Query() query: Record<string, unknown>,
  ) {
    const clientId = asString(query.client_id);
    const redirectUri = asString(query.redirect_uri);
    const state = asString(query.state);
    if (asString(query.response_type) !== 'code') {
      throw new BadRequestException('仅支持 response_type=code');
    }
    if (!clientId) throw new BadRequestException('缺少 client_id');
    if (!redirectUri) throw new BadRequestException('缺少 redirect_uri');

    const token = readCookie(req, AUTH_COOKIE);
    const user = token ? await this.authService.getUserByToken(token) : null;
    if (!user) {
      // 未登录：先校验接入方（快速失败），暂存上下文后走飞书登录
      await this.sso.assertAuthorizeClient(clientId, redirectUri);
      res.cookie(
        SSO_CONTEXT_COOKIE,
        JSON.stringify({ clientId, redirectUri, state: state || null }),
        this.sso.contextCookieOptions(),
      );
      return res.redirect('/api/auth/feishu');
    }
    return res.redirect(
      await this.sso.buildAuthorizeRedirect(user, {
        clientId,
        redirectUri,
        state: state || null,
      }),
    );
  }

  /**
   * 令牌端点（接入方服务端调用）：授权码 + client 凭证换 access_token。
   * 凭证支持 Basic Auth 或表单/JSON body；错误按 OAuth2 标准 { error, error_description } 返回。
   */
  @Public()
  @Post('token')
  async token(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const credentials = this.parseClientCredentials(req, body);
    try {
      return await this.sso.exchangeToken({
        grantType: asString(body.grant_type),
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        code: asString(body.code),
        redirectUri: asString(body.redirect_uri),
      });
    } catch (e) {
      if (e instanceof SsoOAuthError) {
        throw new HttpException(
          { error: e.error, error_description: e.description },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw e;
    }
  }

  /** 用户信息端点：Bearer access_token 换用户基础信息 + 飞书标识 */
  @Public()
  @Get('userinfo')
  async userinfo(@Req() req: Request): Promise<unknown> {
    const header = req.headers.authorization;
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : '';
    if (!token) {
      throw new UnauthorizedException(
        '缺少 Authorization: Bearer access_token',
      );
    }
    try {
      return await this.sso.getUserInfoByAccessToken(token);
    } catch (e) {
      if (e instanceof SsoOAuthError) {
        throw new HttpException(
          { error: e.error, error_description: e.description },
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw e;
    }
  }

  // ---- 管理端点（管理区「SSO 应用」） ----

  @Get('clients')
  list(@Req() req: AuthedRequest): Promise<SsoClientView[]> {
    assertAdmin(req.user);
    return this.sso.list();
  }

  @Post('clients')
  create(
    @Req() req: AuthedRequest,
    @Body() body: SaveSsoClientInput,
  ): Promise<SsoClientCreated> {
    assertAdmin(req.user);
    return this.sso.create(body);
  }

  @Patch('clients/:id')
  update(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SaveSsoClientInput,
  ): Promise<SsoClientView> {
    assertAdmin(req.user);
    return this.sso.update(id, body);
  }

  /** 重置密钥：旧密钥立即失效，新密钥仅在本次响应中返回一次 */
  @Post('clients/:id/secret-reset')
  resetSecret(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ clientSecret: string }> {
    assertAdmin(req.user);
    return this.sso.resetSecret(id);
  }

  @Delete('clients/:id')
  async remove(
    @Req() req: AuthedRequest,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<{ ok: true }> {
    assertAdmin(req.user);
    return this.sso.remove(id);
  }

  /** client 凭证：优先 Basic Auth（base64(client_id:client_secret)），回退 body 字段 */
  private parseClientCredentials(
    req: Request,
    body: Record<string, unknown>,
  ): { clientId: string | undefined; clientSecret: string | undefined } {
    const header = req.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString(
          'utf8',
        );
        const idx = decoded.indexOf(':');
        if (idx >= 0) {
          return {
            clientId: decoded.slice(0, idx),
            clientSecret: decoded.slice(idx + 1),
          };
        }
      } catch {
        // 解码失败时回退 body 凭证
      }
    }
    return {
      clientId: asString(body.client_id) || undefined,
      clientSecret: asString(body.client_secret) || undefined,
    };
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import axios, { AxiosInstance } from 'axios';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';
import { UserRole } from '../common/enums';
import { FeishuService } from '../feishu/feishu.service';
import { User } from './user.entity';

/** 登录成功后发送的飞书欢迎消息标题 */
const WELCOME_TITLE = '你好，欢迎登录 project';

/** 登录会话 Cookie 名（HttpOnly，JWT） */
export const AUTH_COOKIE = 'pmp_auth';
/** OAuth state Cookie 名（防 CSRF，短效） */
export const OAUTH_STATE_COOKIE = 'pmp_oauth_state';
/** 会话有效期：7 天，过期重新走飞书登录（不做 refresh token） */
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** 飞书用户信息（authen/v1/user_info 返回的子集） */
export interface FeishuUserInfo {
  openId: string;
  unionId: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

/** 飞书 OAuth 用户令牌（用于代表用户搜索云文档） */
export interface FeishuOAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** 访问令牌过期时间 */
  expiresAt: Date;
}

export interface FeishuLoginResult {
  info: FeishuUserInfo;
  tokens: FeishuOAuthTokens;
}

/** 飞书应用凭据（网页登录直接依赖，不同于 tenant token 的 Lita 来源） */
interface FeishuAppCredential {
  appId: string;
  appSecret: string;
  /** OAuth 回调地址：{APP_URL}/api/auth/feishu/callback（dev 经 vite 代理、生产同域反代，同一地址两用） */
  redirectUri: string;
}

/**
 * 飞书 OAuth 网页登录 + 会话签发。
 * 流程：GET /api/auth/feishu 302 授权页 → 回调换 user_access_token → 取用户信息 →
 * 按 open_id upsert users → JWT 写 HttpOnly Cookie。
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly http: AxiosInstance;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    private readonly feishu: FeishuService,
  ) {
    this.http = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 30_000,
    });
  }

  /** 生成 OAuth state（随机 hex，回调时与短效 Cookie 比对防 CSRF） */
  generateState(): string {
    return randomBytes(16).toString('hex');
  }

  /** 飞书网页授权地址（authen/v1/index） */
  buildAuthorizeUrl(state: string): string {
    const { appId, redirectUri } = this.getFeishuCredential();
    const params = new URLSearchParams({
      app_id: appId,
      redirect_uri: redirectUri,
      state,
    });
    return `https://open.feishu.cn/open-apis/authen/v1/index?${params.toString()}`;
  }

  /** 授权码换用户信息：POST authen/v2/oauth/token → GET authen/v1/user_info */
  async exchangeCodeForUser(code: string): Promise<FeishuUserInfo> {
    return (await this.exchangeCodeForLogin(code)).info;
  }

  /**
   * 登录授权码换取用户信息和 OAuth 令牌。
   * user_access_token 用于代表用户搜索其可见飞书云文档；refresh_token 用于过期自动续期。
   */
  async exchangeCodeForLogin(code: string): Promise<FeishuLoginResult> {
    const { appId, appSecret, redirectUri } = this.getFeishuCredential();
    let accessToken: string;
    let refreshToken: string | null = null;
    let expiresIn = 7200;
    try {
      const { data } = await this.http.post<{
        code?: number;
        msg?: string;
        error?: string;
        error_description?: string;
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      }>('/authen/v2/oauth/token', {
        grant_type: 'authorization_code',
        client_id: appId,
        client_secret: appSecret,
        code,
        redirect_uri: redirectUri,
      });
      if (!data.access_token) {
        throw new BadRequestException(
          `飞书授权码换取失败: ${data.error_description ?? data.error ?? data.msg ?? `code ${data.code ?? '未知'}`}（授权码 5 分钟有效且一次性，请重试登录）`,
        );
      }
      accessToken = data.access_token;
      refreshToken = data.refresh_token ?? null;
      if (typeof data.expires_in === 'number' && data.expires_in > 0) {
        expiresIn = data.expires_in;
      }
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      if (axios.isAxiosError(e) && e.response) {
        const detail = e.response.data as
          | { error_description?: string; error?: string; msg?: string }
          | undefined;
        throw new BadRequestException(
          `飞书授权码换取失败: ${detail?.error_description ?? detail?.error ?? detail?.msg ?? e.message}`,
        );
      }
      throw e;
    }
    return {
      info: await this.fetchUserInfo(accessToken),
      tokens: {
        accessToken,
        refreshToken,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      },
    };
  }

  /** 按 open_id upsert 用户；尚无管理员时首个登录用户自动授予管理员；每次登录刷新姓名/头像/邮箱/部门与 lastLoginAt */
  async upsertFeishuUser(
    info: FeishuUserInfo,
    tokens?: FeishuOAuthTokens,
  ): Promise<User> {
    // 部门查不到（无通讯录权限等）为 null，更新时保留旧值
    const department = await this.feishu.getUserDepartment(info.openId);
    const existing = await this.usersRepo.findOne({
      where: { feishuOpenId: info.openId },
    });
    if (existing) {
      existing.name = info.name ?? existing.name;
      existing.avatarUrl = info.avatarUrl ?? existing.avatarUrl;
      existing.email = info.email ?? existing.email;
      existing.department = department ?? existing.department;
      existing.unionId = info.unionId ?? existing.unionId;
      existing.lastLoginAt = new Date();
      this.applyFeishuTokens(existing, tokens);
      const user = await this.usersRepo.save(existing);
      await this.sendWelcome(user);
      return user;
    }
    // 首个「登录」用户授予管理员：以库内是否已有管理员判定，
    // 避免通讯录全量同步预置的（未登录）用户占掉首个管理员名额
    const adminCount = await this.usersRepo.count({
      where: { role: UserRole.ADMIN },
    });
    const user = this.usersRepo.create({
      feishuOpenId: info.openId,
      unionId: info.unionId,
      name: info.name ?? info.openId,
      avatarUrl: info.avatarUrl,
      email: info.email,
      department,
      role: adminCount === 0 ? UserRole.ADMIN : UserRole.MEMBER,
      enabled: true,
      lastLoginAt: new Date(),
    });
    this.applyFeishuTokens(user, tokens);
    this.logger.log(
      `新用户登录落库: ${user.name}（open_id=${info.openId}，角色=${user.role}）`,
    );
    const saved = await this.usersRepo.save(user);
    await this.sendWelcome(saved);
    return saved;
  }

  private applyFeishuTokens(user: User, tokens?: FeishuOAuthTokens): void {
    if (!tokens) return;
    user.feishuAccessToken = tokens.accessToken;
    user.feishuRefreshToken = tokens.refreshToken;
    user.feishuTokenExpiresAt = tokens.expiresAt;
  }

  /**
   * 取用户可用于飞书搜索的 user_access_token。
   * 令牌未过期直接返回；过期时用 refresh_token 自动续期；都没有则要求重新登录授权。
   */
  async getFeishuAccessToken(userId: number): Promise<string> {
    const user = await this.usersRepo
      .createQueryBuilder('user')
      .addSelect(['user.feishuAccessToken', 'user.feishuRefreshToken'])
      .where('user.id = :id', { id: userId })
      .getOne();
    if (!user) throw new UnauthorizedException('用户不存在');
    const valid =
      user.feishuAccessToken &&
      (!user.feishuTokenExpiresAt ||
        user.feishuTokenExpiresAt.getTime() > Date.now() + 5 * 60 * 1000);
    if (valid) return user.feishuAccessToken as string;
    if (!user.feishuRefreshToken) {
      throw new BadRequestException(
        '飞书用户授权已过期，请重新通过飞书登录后再搜索飞书文档',
      );
    }
    const { appId, appSecret } = this.getFeishuCredential();
    try {
      const { data } = await this.http.post<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        error?: string;
        error_description?: string;
      }>('/authen/v2/oauth/token', {
        grant_type: 'refresh_token',
        client_id: appId,
        client_secret: appSecret,
        refresh_token: user.feishuRefreshToken,
      });
      if (!data.access_token) {
        throw new Error(
          data.error_description ?? data.error ?? '飞书未返回新的访问令牌',
        );
      }
      const expiresIn =
        typeof data.expires_in === 'number' && data.expires_in > 0
          ? data.expires_in
          : 7200;
      user.feishuAccessToken = data.access_token;
      user.feishuRefreshToken = data.refresh_token ?? user.feishuRefreshToken;
      user.feishuTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
      await this.usersRepo.save(user);
      return data.access_token;
    } catch (e) {
      this.logger.warn(
        `飞书 user_access_token 刷新失败（用户 ${userId}）: ${(e as Error).message}`,
      );
      throw new BadRequestException(
        '飞书用户授权已失效，请重新通过飞书登录后再搜索飞书文档',
      );
    }
  }

  /**
   * 登录成功后发飞书欢迎卡片（应用机器人单聊）：平台介绍 + SKILL 安装指引 + 核心任务流。
   * 失败仅告警不阻断登录——应用未开发送权限/用户不在可用范围时发送会失败，属预期降级。
   */
  private async sendWelcome(user: User): Promise<void> {
    try {
      await this.feishu.sendUserCard(
        user.feishuOpenId,
        this.buildWelcomeCard(),
      );
    } catch (e) {
      this.logger.warn(
        `欢迎消息发送失败（${user.name}, open_id=${user.feishuOpenId}）: ${(e as Error).message}`,
      );
    }
  }

  /** 欢迎卡片：介绍 + SKILL 安装 + 核心任务流（口径与前端概览页一致） */
  private buildWelcomeCard(): Record<string, unknown> {
    const appUrl = (
      this.config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/$/, '');
    const skillUrl = `${appUrl}/SKILL.md`;
    const installCmd = `mkdir -p ~/.opencode/skills/project-manage && curl -fsSL ${skillUrl} -o ~/.opencode/skills/project-manage/SKILL.md`;
    const md = (content: string) => ({
      tag: 'div',
      text: { tag: 'lark_md', content },
    });
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: WELCOME_TITLE },
        template: 'blue',
      },
      elements: [
        md(
          '**project** 是 Lita 的项目管理系统：以 AI 为中心，项目的文档、资料、脚本、缺陷、定时任务等研发要素统一管理。网页供人操作，同时所有能力以 HTTP 接口暴露，AI agent 可直接读写并流式获取运行结果。',
        ),
        { tag: 'hr' },
        md(
          [
            '**安装 SKILL.md（让 AI 学会操作本平台）**',
            `**1. 在线地址**：${skillUrl}`,
            '**2. 安装到 opencode**（推荐，安装后重启会话生效；SKILL 随平台迭代，更新时重跑覆盖）：',
            installCmd,
            `**3. 免安装用法**：直接告诉 Agent「读取 ${skillUrl}，按说明操作项目管理平台」`,
          ].join('\n'),
        ),
        { tag: 'hr' },
        md(
          [
            '**核心任务流**',
            '**文档**：飞书 / APIPOST 一键导入为统一 Markdown，也可平台内手写，人与 AI 共读',
            '**资料**：需求方提供的配置 / 多语言 / UI / 文件资源，按状态跟踪（缺失 → 草稿 → 确认）',
            '**脚本**：.check.ts 检查 / .test.ts 测试用例 / .export.ts 导出，登记后一键运行、实时流式看过程与结果',
            '**缺陷**：预期 / 实际 / 截图 / 用例脚本登记，状态流转 开放 → 修复 → 关闭，脚本回归通过自动关闭',
            '**定时任务**：crontab 定时运行检查脚本，开始与结果自动推送项目飞书群',
            '**导出脚本**：本地直跑产出数据文件（csv / json 等），产物文件在线下载',
            '**测试用例**：覆盖 H5 / 后端 / APP（android / ios）三端，APP 用例经 appium-agent 远程执行',
          ].join('\n'),
        ),
        { tag: 'hr' },
        {
          tag: 'action',
          actions: [
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '打开平台' },
              type: 'primary',
              url: appUrl,
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '查看 SKILL.md' },
              type: 'default',
              url: skillUrl,
            },
          ],
        },
      ],
    };
  }

  /** 签发会话 JWT（sub=用户 id，7 天有效） */
  signSessionToken(user: User): string {
    return jwt.sign({ role: user.role, name: user.name }, this.getJwtSecret(), {
      subject: String(user.id),
      expiresIn: SESSION_TTL_SECONDS,
    });
  }

  /** 会话 Cookie 配置（HttpOnly/SameSite=Lax；Secure 仅 https 部署开启，防内网 http 下 Cookie 失效） */
  sessionCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: SESSION_TTL_SECONDS * 1000,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
    };
  }

  /** state Cookie 配置（10 分钟短效） */
  stateCookieOptions() {
    return {
      httpOnly: true,
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 10 * 60 * 1000,
      secure: this.config.get<string>('COOKIE_SECURE') === 'true',
    };
  }

  /** 校验会话 JWT 并取最新用户（角色/禁用即时生效，enabled=false 视为未登录） */
  async getUserByToken(token: string): Promise<User | null> {
    try {
      const payload = jwt.verify(token, this.getJwtSecret()) as jwt.JwtPayload;
      const userId = Number(payload.sub);
      if (!Number.isInteger(userId)) return null;
      const user = await this.usersRepo.findOne({ where: { id: userId } });
      return user && user.enabled ? user : null;
    } catch {
      return null;
    }
  }

  /** 取用户的 agent 访问令牌，尚未发放则生成（首次在个人中心查看时发放） */
  async ensureAgentToken(userId: number): Promise<string> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    if (user.agentToken) return user.agentToken;
    user.agentToken = this.generateAgentToken();
    await this.usersRepo.save(user);
    return user.agentToken;
  }

  /** 重置 agent 访问令牌（旧令牌立即失效，需同步更新 agent 侧配置） */
  async resetAgentToken(userId: number): Promise<string> {
    const user = await this.usersRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    user.agentToken = this.generateAgentToken();
    await this.usersRepo.save(user);
    this.logger.log(`agent 访问令牌已重置: ${user.name}（id=${user.id}）`);
    return user.agentToken;
  }

  /** 按 agent 访问令牌查用户（.md 端点鉴权用，enabled=false 视为无效） */
  async getUserByAgentToken(token: string): Promise<User | null> {
    if (!token) return null;
    const user = await this.usersRepo.findOne({
      where: { agentToken: token },
    });
    return user && user.enabled ? user : null;
  }

  /**
   * 用户系统全量名单（按姓名排序）：项目人员/提测测试人员等配置的合法来源，
   * 亦供管理端「用户列表」页展示（含头像/邮箱/角色/最近登录）。
   */
  listUsers(): Promise<
    {
      id: number;
      name: string;
      department: string | null;
      avatarUrl: string | null;
      email: string | null;
      role: UserRole;
      lastLoginAt: Date | null;
    }[]
  > {
    return this.usersRepo.find({
      select: {
        id: true,
        name: true,
        department: true,
        avatarUrl: true,
        email: true,
        role: true,
        lastLoginAt: true,
      },
      order: { name: 'ASC' },
    });
  }

  /**
   * 全量同步飞书通讯录到本地用户表（定时任务/启动时调用）。
   * 遍历所有部门成员去重后按 open_id upsert：
   * - 已存在：仅刷新姓名/头像/union_id/部门（非空才覆盖），保留邮箱/角色/登录态/agent 令牌
   * - 不存在：新建为「成员」，lastLoginAt 留空（未登录），不发送欢迎消息
   * 仅取姓名/头像/部门等基础信息（邮箱需额外飞书权限，未取）。
   */
  async syncFeishuUsers(): Promise<{
    total: number;
    created: number;
    updated: number;
  }> {
    const contacts = await this.feishu.listAllUsers();
    let created = 0;
    let updated = 0;
    for (const c of contacts) {
      const existing = await this.usersRepo.findOne({
        where: { feishuOpenId: c.openId },
      });
      if (existing) {
        existing.name = c.name || existing.name;
        existing.avatarUrl = c.avatarUrl ?? existing.avatarUrl;
        existing.unionId = c.unionId ?? existing.unionId;
        existing.department = c.department ?? existing.department;
        await this.usersRepo.save(existing);
        updated++;
      } else {
        await this.usersRepo.save(
          this.usersRepo.create({
            feishuOpenId: c.openId,
            unionId: c.unionId,
            name: c.name || c.openId,
            avatarUrl: c.avatarUrl,
            email: null,
            department: c.department,
            role: UserRole.MEMBER,
            enabled: true,
            lastLoginAt: null,
          }),
        );
        created++;
      }
    }
    this.logger.log(
      `飞书通讯录同步完成：共 ${contacts.length} 人（新增 ${created}，更新 ${updated}）`,
    );
    return { total: contacts.length, created, updated };
  }

  // ---- 内部 ----

  /** 生成 agent 访问令牌（48 位随机 hex） */
  private generateAgentToken(): string {
    return randomBytes(24).toString('hex');
  }

  /** 飞书应用凭据（登录直接依赖 app_id/secret；tenant token 的 Lita 来源不适用于 OAuth） */
  private getFeishuCredential(): FeishuAppCredential {
    const appId = this.config.get<string>('FEISHU_APP_ID');
    const appSecret = this.config.get<string>('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      throw new BadRequestException(
        '飞书登录未配置：缺少 FEISHU_APP_ID / FEISHU_APP_SECRET（需在飞书后台开启「网页授权登录」能力）',
      );
    }
    const appUrl =
      this.config.get<string>('APP_URL') ?? 'http://localhost:5273';
    return {
      appId,
      appSecret,
      redirectUri: `${appUrl.replace(/\/$/, '')}/api/auth/feishu/callback`,
    };
  }

  private getJwtSecret(): string {
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (secret) return secret;
    this.logger.warn(
      '未配置 AUTH_JWT_SECRET，使用内置默认值（仅限开发环境，生产必须配置）',
    );
    return 'pmp-dev-insecure-secret';
  }

  /** authen/v1/user_info：应用无邮箱等权限时对应字段为空，列可空容错 */
  private async fetchUserInfo(
    userAccessToken: string,
  ): Promise<FeishuUserInfo> {
    const { data } = await this.http.get<{
      code: number;
      msg?: string;
      data?: {
        open_id?: string;
        union_id?: string;
        name?: string;
        avatar_url?: string;
        email?: string;
      };
    }>('/authen/v1/user_info', {
      headers: { Authorization: `Bearer ${userAccessToken}` },
    });
    if (data.code !== 0 || !data.data?.open_id) {
      throw new BadRequestException(
        `获取飞书用户信息失败: ${data.msg ?? `code ${data.code}`}`,
      );
    }
    return {
      openId: data.data.open_id,
      unionId: data.data.union_id ?? null,
      name: data.data.name ?? null,
      avatarUrl: data.data.avatar_url ?? null,
      email: data.data.email ?? null,
    };
  }
}

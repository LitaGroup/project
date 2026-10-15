import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
import { promises as fs } from 'fs';
import * as path from 'path';
import { imageWebroot } from '../common/paths';
import {
  bitableRecordsToMarkdown,
  docxBlocksToMarkdown,
  sheetValuesToMarkdown,
  type BitableFieldMeta,
} from './feishu-markdown';

/** 飞书资源类型，从 URL 解析得出 */
export type FeishuResourceType = 'docx' | 'sheets' | 'bitable';

export interface FeishuResourceRef {
  type: FeishuResourceType;
  /** docx: document_id；sheets: spreadsheet_token；bitable: app_token */
  token: string;
}

export interface FeishuReadResult {
  type: FeishuResourceType;
  /**
   * 同步判重 key：`docx:<id>` / `sheets:<token>#<sheetId>` / `bitable:<token>#<tableId>`，
   * 保证同一表格不同 sheet / 同一多维表格不同 table 互不覆盖
   */
  feishuKey: string;
  title: string;
  /** 统一输出：Markdown */
  content: string;
}

/** 多维表格记录（含记录级时间戳，用于增量同步过滤） */
export interface BitableRecord {
  record_id: string;
  last_modified_time?: number;
  fields: Record<string, unknown>;
}

interface TenantTokenCache {
  token: string;
  /** epoch 毫秒 */
  expireAt: number;
}

/** 依据魔数识别图片扩展名（识别不出时按 Content-Type 兜底，默认 .png） */
function extFromMagic(buf: Buffer, contentType?: string): string {
  if (buf.length >= 12) {
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
    if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
    if (buf.subarray(0, 3).toString('ascii') === 'GIF') return '.gif';
    if (
      buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buf.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return '.webp';
    }
  }
  const ct = (contentType ?? '').toLowerCase();
  if (ct.includes('jpeg')) return '.jpg';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  return '.png';
}

/**
 * 飞书开放平台客户端。
 * 只读（单向导入：文档/项目/缺陷已解绑，飞书 → 平台，不回写）。
 * 凭据：Lita 平台 token 服务（LITA_USER_TOKEN），兜底 FEISHU_APP_ID / FEISHU_APP_SECRET。
 */
@Injectable()
export class FeishuService implements OnModuleInit {
  private readonly logger = new Logger(FeishuService.name);
  private readonly http: AxiosInstance;
  private tokenCache: TenantTokenCache | null = null;

  constructor(private readonly config: ConfigService) {
    this.http = axios.create({
      baseURL: 'https://open.feishu.cn/open-apis',
      timeout: 60_000,
    });
  }

  /** 启动即拉取一次 token；失败不阻断启动（首次真实调用时会再尝试） */
  async onModuleInit(): Promise<void> {
    await this.refreshTokenSafely('启动预热');
  }

  /** 定时刷新：每 30 分钟一次（token 有效期约 2 小时） */
  @Cron(CronExpression.EVERY_30_MINUTES)
  async scheduledRefresh(): Promise<void> {
    await this.refreshTokenSafely('定时刷新');
  }

  private async refreshTokenSafely(scene: string): Promise<void> {
    try {
      await this.refreshToken();
    } catch (e) {
      this.logger.warn(`飞书 token ${scene}失败: ${(e as Error).message}`);
    }
  }

  /**
   * 解析飞书 URL，支持：
   * - .../docx/<token>      新版文档
   * - .../docs/<token>      旧版文档（升级为 docx 后 token 兼容）
   * - .../sheets/<token>    电子表格
   * - .../base/<token>      多维表格
   * - .../wiki/<token>      知识库节点（先解析为实际 obj）
   */
  parseUrl(url: string): FeishuResourceRef {
    const match = url.match(
      /(?:feishu\.cn|larksuite\.com)\/(docx|docs|sheets|base|wiki)\/([A-Za-z0-9]+)/,
    );
    if (!match) {
      throw new BadRequestException(`无法识别的飞书链接: ${url}`);
    }
    const [, kind, token] = match;
    if (kind === 'docx' || kind === 'docs') {
      return { type: 'docx', token };
    }
    if (kind === 'sheets') return { type: 'sheets', token };
    if (kind === 'base') return { type: 'bitable', token };
    throw new BadRequestException(
      '知识库链接请先通过 resolveWiki 解析，parseUrl 不直接支持 wiki',
    );
  }

  /** 知识库节点 → 实际文档引用（飞书链接常见形态） */
  async resolveWiki(wikiToken: string): Promise<FeishuResourceRef> {
    const data = await this.request<{
      node: { obj_token: string; obj_type: string };
    }>('GET', '/wiki/v2/spaces/get_node', { params: { token: wikiToken } });
    const { obj_token, obj_type } = data.node;
    if (obj_type === 'docx' || obj_type === 'doc') {
      return { type: 'docx', token: obj_token };
    }
    if (obj_type === 'sheet') return { type: 'sheets', token: obj_token };
    if (obj_type === 'bitable') return { type: 'bitable', token: obj_token };
    throw new BadRequestException(`暂不支持的飞书知识库节点类型: ${obj_type}`);
  }

  /** 统一入口：传入任意支持的飞书链接（可带 ?sheet= / ?table=&view= 参数），返回标题与 Markdown 内容 */
  async readByUrl(url: string): Promise<FeishuReadResult> {
    let query = new URLSearchParams();
    try {
      query = new URL(url).searchParams;
    } catch {
      /* 非完整 URL 时忽略 query */
    }
    const wikiMatch = url.match(
      /(?:feishu\.cn|larksuite\.com)\/wiki\/([A-Za-z0-9]+)/,
    );
    const ref = wikiMatch
      ? await this.resolveWiki(wikiMatch[1])
      : this.parseUrl(url);
    switch (ref.type) {
      case 'docx':
        return this.readDocx(ref.token);
      case 'sheets':
        return this.readSheet(ref.token, query.get('sheet') ?? undefined);
      case 'bitable':
        return this.readBitable(
          ref.token,
          query.get('table') ?? undefined,
          query.get('view') ?? undefined,
        );
    }
  }

  /** 新版文档：标题 + 块级转 Markdown；图片块下载到本地图片目录后以内链引用 */
  async readDocx(documentId: string): Promise<FeishuReadResult> {
    const meta = await this.request<{ document: { title: string } }>(
      'GET',
      `/docx/v1/documents/${documentId}`,
    );
    const blocks: unknown[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: unknown[];
        has_more: boolean;
        page_token?: string;
      }>('GET', `/docx/v1/documents/${documentId}/blocks`, {
        params: { page_size: 500, page_token: pageToken },
      });
      blocks.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    const imageUrls = await this.downloadDocxImages(blocks);
    return {
      type: 'docx',
      feishuKey: `docx:${documentId}`,
      title: meta.document.title,
      content: docxBlocksToMarkdown(blocks as never, imageUrls),
    };
  }

  /**
   * 下载文档内图片素材（block_type=27 的 image.token）到本地图片目录
   * （imageWebroot()/feishu/{YYYYMMDD}/{token}.{ext}，经 /images/... 对外访问），
   * 返回 token → 链接映射；单张失败仅记录告警并跳过（转换时降级为占位文本）。
   */
  private async downloadDocxImages(
    blocks: unknown[],
  ): Promise<Map<string, string>> {
    const tokens = [
      ...new Set(
        blocks
          .map((b) => (b as { image?: { token?: string } }).image?.token)
          .filter((t): t is string => !!t),
      ),
    ];
    if (tokens.length === 0) return new Map();
    const results = await Promise.all(
      tokens.map(async (token, index) => {
        try {
          // 错峰启动，避免并发触发飞书接口频控（99991400）
          await new Promise((resolve) => setTimeout(resolve, index * 200));
          return [token, await this.downloadMediaWithRetry(token)] as const;
        } catch (e) {
          this.logger.warn(
            `飞书图片下载失败 ${token}: ${(e as Error).message}`,
          );
          return null;
        }
      }),
    );
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .format(new Date())
      .replace(/-/g, '');
    const map = new Map<string, string>();
    for (const result of results) {
      if (!result) continue;
      const [token, media] = result;
      const relPath = path.posix.join(
        'feishu',
        date,
        `${token}${extFromMagic(media.buffer, media.contentType)}`,
      );
      const absPath = path.join(imageWebroot(), relPath);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, media.buffer);
      map.set(token, `/images/${relPath}`);
    }
    return map;
  }

  /**
   * 下载媒体素材（含瞬态失败重试）：频控（99991400）等 1.5s 重试，
   * 403 等待 800ms 重试一次——飞书权限传播是最终一致的，窗口期内会抖动；
   * 仍失败按原错误抛出（调用方降级跳过，下次同步可恢复）。
   */
  private async downloadMediaWithRetry(
    fileToken: string,
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    try {
      return await this.downloadMedia(fileToken);
    } catch (e) {
      const message = (e as Error).message;
      const rateLimited =
        message.includes('99991400') || message.includes('frequency');
      if (!rateLimited && !message.includes('403')) {
        throw e;
      }
      this.logger.warn(
        `飞书图片下载瞬态失败（${rateLimited ? '频控' : '403'}），稍后重试 ${fileToken}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, rateLimited ? 1500 : 800),
      );
      return this.downloadMedia(fileToken);
    }
  }

  /**
   * 下载媒体素材二进制：优先 drive 直下（需素材下载权限），失败退回临时下载链接；
   * 两者都无权限时抛错（调用方降级跳过）。
   */
  private async downloadMedia(
    fileToken: string,
  ): Promise<{ buffer: Buffer; contentType?: string }> {
    try {
      const token = await this.getTenantAccessToken();
      const resp = await this.http.get<ArrayBuffer>(
        `/drive/v1/medias/${fileToken}/download`,
        {
          headers: { Authorization: `Bearer ${token}` },
          responseType: 'arraybuffer',
          timeout: 60_000,
        },
      );
      return {
        buffer: Buffer.from(resp.data),
        contentType: resp.headers?.['content-type'] as string | undefined,
      };
    } catch {
      const data = await this.request<{
        tmp_download_urls: { tmp_download_url?: string }[];
      }>('GET', '/drive/v1/medias/batch_get_tmp_download_url', {
        params: { file_tokens: fileToken },
      });
      const url = data.tmp_download_urls?.[0]?.tmp_download_url;
      if (!url) {
        throw new BadRequestException(
          '媒体下载无权限（需 Lita 应用具备素材下载/drive 只读权限）',
        );
      }
      const resp = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 60_000,
      });
      return {
        buffer: Buffer.from(resp.data),
        contentType: resp.headers?.['content-type'] as string | undefined,
      };
    }
  }

  /** 电子表格：只导入指定 sheet（链接 ?sheet= 参数）；未指定时取第一个工作表 */
  async readSheet(
    spreadsheetToken: string,
    sheetId?: string,
  ): Promise<FeishuReadResult> {
    const [meta, sheets] = await Promise.all([
      this.request<{ spreadsheet: { title: string } }>(
        'GET',
        `/sheets/v3/spreadsheets/${spreadsheetToken}`,
      ),
      this.request<{ sheets: { sheet_id: string; title: string }[] }>(
        'GET',
        `/sheets/v3/spreadsheets/${spreadsheetToken}/sheets/query`,
      ),
    ]);
    const target = sheetId
      ? sheets.sheets.find((s) => s.sheet_id === sheetId)
      : sheets.sheets[0];
    if (!target) {
      throw new BadRequestException(
        sheetId ? `未找到指定的工作表: ${sheetId}` : '该表格没有任何工作表',
      );
    }
    // valueRenderOption=ToString：按表格实际显示取值（公式返回计算结果而非公式文本）；
    // dateTimeRenderOption=FormattedString：日期返回显示文本（如 8/17）而非序列号
    const values = await this.request<{ valueRange: { values: unknown[][] } }>(
      'GET',
      `/sheets/v2/spreadsheets/${spreadsheetToken}/values/${target.sheet_id}`,
      {
        params: {
          valueRenderOption: 'ToString',
          dateTimeRenderOption: 'FormattedString',
        },
      },
    );
    return {
      type: 'sheets',
      feishuKey: `sheets:${spreadsheetToken}#${target.sheet_id}`,
      title: `${meta.spreadsheet.title} - ${target.title}`,
      content: sheetValuesToMarkdown(values.valueRange.values ?? []),
    };
  }

  /** 多维表格：只导入链接中指定的 table（?table= 参数，可选 ?view=）；未指定时取第一张数据表 */
  async readBitable(
    appToken: string,
    tableId?: string,
    viewId?: string,
  ): Promise<FeishuReadResult> {
    const [meta, tables] = await Promise.all([
      this.request<{ app: { name: string } }>(
        'GET',
        `/bitable/v1/apps/${appToken}`,
      ),
      this.request<{ items: { table_id: string; name: string }[] }>(
        'GET',
        `/bitable/v1/apps/${appToken}/tables`,
      ),
    ]);
    const target = tableId
      ? tables.items.find((t) => t.table_id === tableId)
      : tables.items[0];
    if (!target) {
      throw new BadRequestException(
        tableId ? `未找到指定的数据表: ${tableId}` : '该多维表格没有任何数据表',
      );
    }
    const [fields, records] = await Promise.all([
      this.request<{ items: BitableFieldMeta[] }>(
        'GET',
        `/bitable/v1/apps/${appToken}/tables/${target.table_id}/fields`,
      ),
      this.searchBitableRecords(appToken, target.table_id, viewId),
    ]);
    return {
      type: 'bitable',
      feishuKey: `bitable:${appToken}#${target.table_id}`,
      title: `${meta.app.name} - ${target.name}`,
      content: bitableRecordsToMarkdown(fields.items ?? [], records),
    };
  }

  /** 按视图全量拉取多维表格记录（自动分页），供增量同步在应用层按 last_modified_time 过滤 */
  async searchBitableRecords(
    appToken: string,
    tableId: string,
    viewId?: string,
  ): Promise<BitableRecord[]> {
    const all: BitableRecord[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: BitableRecord[];
        has_more: boolean;
        page_token?: string;
      }>(
        'POST',
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
        {
          params: { page_size: 500, page_token: pageToken },
          // automatic_fields=true 才会返回记录级 last_modified_time（增量同步依赖它）
          data: { view_id: viewId, automatic_fields: true },
        },
      );
      all.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return all;
  }

  // ---- 内部 ----

  /**
   * 以应用机器人身份给指定用户发单聊文本消息。
   * 前置：应用开通「以应用身份发消息」权限（im:message:send_as_bot）且用户在应用可用范围内。
   * 供登录欢迎语等场景使用；失败抛 BadRequestException，由调用方决定是否降级。
   */
  async sendUserText(openId: string, text: string): Promise<void> {
    await this.request('POST', '/im/v1/messages', {
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    });
  }

  /** 以应用机器人身份给指定用户发单聊卡片消息（interactive），供欢迎指南等场景使用 */
  async sendUserCard(
    openId: string,
    card: Record<string, unknown>,
  ): Promise<void> {
    await this.request('POST', '/im/v1/messages', {
      params: { receive_id_type: 'open_id' },
      data: {
        receive_id: openId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      },
    });
  }

  /**
   * 查用户主部门名称：contact v3 用户详情取 department_ids 首个 → 部门详情取 name。
   * 需应用具备通讯录读权限：用户组织信息 contact:user.department:readonly（否则响应不含
   * department_ids）与部门基础信息 contact:department.base:readonly（否则部门详情不含 name），
   * 并将用户纳入应用「通讯录数据权限范围」。任一步取不到均返回 null（调用方降级，不阻断登录）。
   */
  async getUserDepartment(openId: string): Promise<string | null> {
    try {
      const data = await this.request<{
        user?: { department_ids?: string[] };
      }>('GET', `/contact/v3/users/${openId}`, {
        params: {
          user_id_type: 'open_id',
          department_id_type: 'department_id',
        },
      });
      const deptId = data.user?.department_ids?.[0];
      if (!deptId) {
        // 权限缺失时飞书返回 200 但字段被静默剔除，无法从异常感知，这里主动告警便于排查
        this.logger.warn(
          `未取到用户部门 ${openId}：响应无 department_ids（需应用具备「获取用户组织信息」contact:user.department:readonly 权限，并将用户纳入通讯录数据权限范围）`,
        );
        return null;
      }
      const dept = await this.request<{
        department?: { name?: string };
      }>('GET', `/contact/v3/departments/${deptId}`, {
        params: { department_id_type: 'department_id' },
      });
      const name = dept.department?.name ?? null;
      if (!name) {
        this.logger.warn(
          `未取到部门名称 ${deptId}：部门详情响应无 name（需应用具备「获取部门基础信息」contact:department.base:readonly 权限）`,
        );
      }
      return name;
    } catch (e) {
      this.logger.warn(
        `获取用户部门失败 ${openId}: ${(e as Error).message}（需通讯录读权限）`,
      );
      return null;
    }
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expireAt) {
      return this.tokenCache.token;
    }
    return this.refreshToken();
  }

  /**
   * 从 Lita 平台 token 服务获取飞书 tenant_access_token。
   * 测试/生产统一走该 API；凭据为 LITA_USER_TOKEN（环境变量）。
   * 兜底：未配置 LITA_USER_TOKEN 时退回自建应用 FEISHU_APP_ID/SECRET 模式。
   */
  async refreshToken(): Promise<string> {
    const userToken = this.config.get<string>('LITA_USER_TOKEN');
    if (!userToken) {
      return this.refreshTokenByAppCredential();
    }
    const host = this.config.get<string>(
      'LITA_API_HOST',
      'https://api.cinta.team',
    );
    const { data } = await axios.post<{
      code?: number;
      status?: number;
      msg?: string;
      message?: string;
      data?: { token?: string; expireAt?: number } | string;
    }>(
      `${host}/admin-ai/v1/auth/platform-token/getToken`,
      { platform: 'feishu', tokenType: 'tenant_access_token' },
      { headers: { 'L-USER-TOKEN': userToken }, timeout: 15_000 },
    );
    const failed =
      (data.code !== undefined && data.code !== 0) ||
      (data.status !== undefined && data.status !== 0);
    if (failed || !data.data) {
      throw new BadRequestException(
        `获取飞书 token 失败: ${data.msg ?? data.message ?? '未知错误'}`,
      );
    }
    const payload =
      typeof data.data === 'string'
        ? { token: data.data, expireAt: Math.floor(Date.now() / 1000) + 7200 }
        : {
            token: data.data.token ?? '',
            expireAt:
              data.data.expireAt ?? Math.floor(Date.now() / 1000) + 7200,
          };
    if (!payload.token) {
      throw new BadRequestException('获取飞书 token 失败：返回为空');
    }
    // expireAt 为秒级时间戳，提前 5 分钟过期
    this.tokenCache = {
      token: payload.token,
      expireAt: (payload.expireAt - 300) * 1000,
    };
    this.logger.log(
      `飞书 token 已刷新，有效期至 ${new Date(payload.expireAt * 1000).toISOString()}`,
    );
    return this.tokenCache.token;
  }

  /** 兜底：自建应用 app_id/app_secret 换 tenant_access_token */
  private async refreshTokenByAppCredential(): Promise<string> {
    const appId = this.config.get<string>('FEISHU_APP_ID');
    const appSecret = this.config.get<string>('FEISHU_APP_SECRET');
    if (!appId || !appSecret) {
      throw new BadRequestException(
        '缺少飞书凭据，请配置 LITA_USER_TOKEN（推荐）或 FEISHU_APP_ID / FEISHU_APP_SECRET',
      );
    }
    const { data } = await this.http.post<{
      code: number;
      msg: string;
      tenant_access_token: string;
      expire: number;
    }>('/auth/v3/tenant_access_token/internal', {
      app_id: appId,
      app_secret: appSecret,
    });
    if (data.code !== 0) {
      throw new BadRequestException(`飞书鉴权失败: ${data.msg}`);
    }
    this.tokenCache = {
      token: data.tenant_access_token,
      expireAt: Date.now() + (data.expire - 300) * 1000,
    };
    return this.tokenCache.token;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    config?: { params?: Record<string, unknown>; data?: unknown },
  ): Promise<T> {
    const token = await this.getTenantAccessToken();
    let body: { code: number; msg: string; data: T };
    try {
      const { data } = await this.http.request<{
        code: number;
        msg: string;
        data: T;
      }>({
        method,
        url: path,
        headers: { Authorization: `Bearer ${token}` },
        params: config?.params,
        data: config?.data,
      });
      body = data;
    } catch (e) {
      // 飞书部分错误（如 131006 权限不足）以非 2xx 状态码返回，axios 会直接抛错，
      // 此时业务错误信息在响应体里，需转成可读的 400 而非兜底 500
      if (axios.isAxiosError(e) && e.response) {
        const detail = e.response.data as
          { code?: number; msg?: string } | undefined;
        const code = detail?.code ?? e.response.status;
        const msg = detail?.msg ?? e.message;
        this.logger.warn(`飞书 API 错误 ${path}: code=${code} msg=${msg}`);
        throw new BadRequestException(`飞书 API 错误: ${msg} (code ${code})`);
      }
      throw e;
    }
    if (body.code !== 0) {
      this.logger.warn(
        `飞书 API 错误 ${path}: code=${body.code} msg=${body.msg}`,
      );
      throw new BadRequestException(
        `飞书 API 错误: ${body.msg} (code ${body.code})`,
      );
    }
    return body.data;
  }
}

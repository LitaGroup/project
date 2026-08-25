import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import axios, { AxiosInstance } from 'axios';
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

/**
 * 飞书开放平台客户端。
 * 以只读为主（单向导入）；唯一的写操作是 updateBitableRecord——
 * 缺陷模块的双向绑定需要把平台内的状态变更回写飞书多维表格（见 defects 模块）。
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

  /** 新版文档：标题 + 块级转 Markdown（图片块暂不导入） */
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
    return {
      type: 'docx',
      feishuKey: `docx:${documentId}`,
      title: meta.document.title,
      content: docxBlocksToMarkdown(blocks as never),
    };
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
   * 更新多维表格单条记录（缺陷模块回写状态用，唯一的写操作）。
   * fields 键为字段名，如 { 状态: 'fixed' }；单选字段直接传选项名（不存在会自动新建）。
   */
  async updateBitableRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await this.request(
      'PUT',
      `/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      { data: { fields } },
    );
  }

  /** 下载附件素材（多维表格附件字段的 file_token），返回二进制内容 */
  async downloadMedia(fileToken: string): Promise<Buffer> {
    const token = await this.getTenantAccessToken();
    const { data } = await this.http.get<ArrayBuffer>(
      `/drive/v1/medias/${fileToken}/download`,
      {
        headers: { Authorization: `Bearer ${token}` },
        responseType: 'arraybuffer',
      },
    );
    return Buffer.from(data);
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
    if (data.code !== 0) {
      this.logger.warn(
        `飞书 API 错误 ${path}: code=${data.code} msg=${data.msg}`,
      );
      throw new BadRequestException(
        `飞书 API 错误: ${data.msg} (code ${data.code})`,
      );
    }
    return data.data;
  }
}

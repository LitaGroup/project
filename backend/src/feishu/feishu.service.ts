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
  feishuCommentsToMarkdown,
  sheetValuesToMarkdown,
  type BitableFieldMeta,
  type FeishuComment,
  type FeishuCommentReply,
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

/** 飞书文档搜索结果（搜索 v2 的脱敏子集） */
export interface FeishuSearchDoc {
  token: string;
  title: string;
  /** 文档 Web 链接（可直接传给 readByUrl 转 Markdown） */
  url: string | null;
  docsType: string;
  entityType: string;
  summary: string;
  ownerName: string | null;
  ownerId: string | null;
  updateTime: number | null;
  createTime: number | null;
}

export interface FeishuSearchPage {
  docs: FeishuSearchDoc[];
  total: number;
  hasMore: boolean;
}

/** 多维表格记录（含记录级时间戳，用于增量同步过滤） */
export interface BitableRecord {
  record_id: string;
  last_modified_time?: number;
  fields: Record<string, unknown>;
}

/** 通讯录用户（仅取用户系统同步所需字段，邮箱/手机等需额外权限，未取） */
export interface FeishuContactUser {
  openId: string;
  unionId: string | null;
  name: string;
  avatarUrl: string | null;
  /** 主部门名（取用户主部门 order，取不到则空） */
  department: string | null;
}

/** 评论回复内容元素（drive v1 评论接口） */
interface RawCommentElement {
  type?: string;
  text_run?: { text?: string };
  docs_link?: { url?: string };
  person?: { user_id?: string };
}

/** 评论回复（接口原始结构，create_time 为秒级时间戳） */
interface RawCommentReply {
  reply_id?: string;
  user_id?: string;
  create_time?: number | string;
  content?: { elements?: RawCommentElement[] };
  extra?: { image_list?: string[] };
}

/** 评论（接口原始结构，含回复列表） */
interface RawComment {
  comment_id?: string;
  user_id?: string;
  create_time?: number | string;
  is_solved?: boolean;
  is_whole?: boolean;
  quote?: string;
  reply_list?: { replies?: RawCommentReply[] };
}

/** contact/v3/users 用户详情响应子集 */
interface FeishuContactUserDetail {
  open_id?: string;
  union_id?: string;
  name?: string;
  en_name?: string;
  department_ids?: string[];
  orders?: { department_id?: string; is_primary_dept?: boolean }[];
  avatar?: {
    avatar_origin?: string;
    avatar_640?: string;
    avatar_240?: string;
    avatar_72?: string;
  };
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

/** 去除搜索高亮 HTML 标签，保留纯文本 */
function stripHighlight(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

const FEISHU_SEARCH_PERMISSION_HINT =
  '飞书应用缺少「搜索云文档」权限（search:docs:read）。请管理员在飞书开放平台「权限管理」中添加该权限并发布应用版本，然后退出并重新登录本平台以刷新用户授权';

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
      /(?:feishu\.cn|larksuite\.com)\/(docx|docs|sheets|base|wiki)\/([A-Za-z0-9_-]+)/,
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
      /(?:feishu\.cn|larksuite\.com)\/wiki\/([A-Za-z0-9_-]+)/,
    );
    const ref = wikiMatch
      ? await this.resolveWiki(wikiMatch[1])
      : this.parseUrl(url);
    switch (ref.type) {
      case 'docx': {
        // 旧版 /docs/ 链接的评论 file_type 为 doc，新版为 docx（影响评论接口参数）
        const legacy = /(?:feishu\.cn|larksuite\.com)\/docs\//.test(url);
        return this.readDocx(ref.token, legacy ? 'doc' : 'docx');
      }
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

  /**
   * 搜索当前飞书用户可见的云文档（Search v2）。
   * 该接口仅支持 user_access_token；调用方须先经 AuthService 取得当前用户的授权。
   * 飞书单页最多 20 条，本方法按 offset/limit 顺序翻页后返回请求页。
   */
  async searchDocs(
    query: string,
    userAccessToken: string,
    options: { offset: number; limit: number },
  ): Promise<FeishuSearchPage> {
    const end = options.offset + options.limit;
    const all: FeishuSearchDoc[] = [];
    let pageToken: string | undefined;
    let total = 0;
    let apiHasMore = false;
    do {
      const pageSize = Math.min(20, Math.max(1, end - all.length));
      let data: {
        total?: number;
        has_more?: boolean;
        page_token?: string;
        res_units?: Array<{
          title_highlighted?: string;
          summary_highlighted?: string;
          entity_type?: string;
          result_meta?: {
            doc_types?: string;
            update_time?: number;
            url?: string;
            owner_name?: string;
            owner_id?: string;
            create_time?: number;
            token?: string;
          };
        }>;
      };
      try {
        const response = await this.http.post<{
          code?: number;
          msg?: string;
          data?: typeof data;
        }>(
          '/search/v2/doc_wiki/search',
          {
            query,
            doc_filter: {
              doc_types: [
                'DOC',
                'DOCX',
                'SHEET',
                'BITABLE',
                'MINDNOTE',
                'FILE',
                'SLIDES',
                'SHORTCUT',
              ],
            },
            wiki_filter: {
              doc_types: [
                'DOC',
                'DOCX',
                'SHEET',
                'BITABLE',
                'MINDNOTE',
                'FILE',
                'WIKI',
                'SLIDES',
                'SHORTCUT',
              ],
            },
            page_size: pageSize,
            ...(pageToken ? { page_token: pageToken } : {}),
          },
          {
            headers: { Authorization: `Bearer ${userAccessToken}` },
          },
        );
        if (response.data.code !== 0 || !response.data.data) {
          if (response.data.code === 99991679) {
            throw new Error(FEISHU_SEARCH_PERMISSION_HINT);
          }
          throw new Error(
            `飞书文档搜索失败（code=${response.data.code ?? '未知'}）：${response.data.msg ?? '未知错误'}`,
          );
        }
        data = response.data.data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
          const body = error.response.data as
            { code?: number; msg?: string } | undefined;
          if (body?.code === 99991679) {
            throw new Error(FEISHU_SEARCH_PERMISSION_HINT);
          }
          throw new Error(
            `飞书文档搜索失败（HTTP ${error.response.status}，code=${body?.code ?? '未知'}）：${body?.msg ?? error.message}`,
          );
        }
        throw error;
      }
      total = data.total ?? total;
      apiHasMore = Boolean(data.has_more);
      for (const unit of data.res_units ?? []) {
        const meta = unit.result_meta ?? {};
        if (!meta.token) continue;
        all.push({
          token: meta.token,
          title: stripHighlight(unit.title_highlighted) || meta.token,
          url: meta.url ?? null,
          docsType: meta.doc_types ?? unit.entity_type ?? 'UNKNOWN',
          entityType: unit.entity_type ?? 'DOC',
          summary: stripHighlight(unit.summary_highlighted),
          ownerName: meta.owner_name ?? null,
          ownerId: meta.owner_id ?? null,
          updateTime: meta.update_time ?? null,
          createTime: meta.create_time ?? null,
        });
      }
      pageToken = apiHasMore ? data.page_token : undefined;
    } while (pageToken && all.length < end);

    return {
      docs: all.slice(options.offset, end),
      total,
      hasMore:
        apiHasMore ||
        all.length > end ||
        (total > 0 && options.offset + options.limit < total),
    };
  }

  /**
   * 新版文档：标题 + 块级转 Markdown；图片块下载到本地图片目录后以内链引用。
   * 文档评论一并导入（追加在正文末尾，分割线 + 「评论」小节），无权限时降级跳过。
   */
  async readDocx(
    documentId: string,
    fileType: 'docx' | 'doc' = 'docx',
  ): Promise<FeishuReadResult> {
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
    const body = docxBlocksToMarkdown(blocks as never, imageUrls);
    const comments = await this.docxCommentsMarkdown(documentId, fileType);
    return {
      type: 'docx',
      feishuKey: `docx:${documentId}`,
      title: meta.document.title,
      content: comments ? `${body}\n\n${comments}` : body,
    };
  }

  /** 评论正文元素 → 纯文本（普通文本 / 云文档链接 / @人） */
  private commentText(elements?: RawCommentElement[]): string {
    return (elements ?? [])
      .map((el) => {
        if (el.text_run?.text) return el.text_run.text;
        if (el.docs_link?.url) return el.docs_link.url;
        if (el.person?.user_id) return `@${el.person.user_id}`;
        return '';
      })
      .join('');
  }

  /** 归一化单条回复（接口 create_time 为秒级时间戳，兼容字符串） */
  private mapCommentReply(raw: RawCommentReply): FeishuCommentReply {
    const seconds = Number(raw.create_time);
    return {
      userId: raw.user_id ?? null,
      createTime: Number.isFinite(seconds) ? seconds : null,
      text: this.commentText(raw.content?.elements).trim(),
      imageCount: raw.extra?.image_list?.length ?? 0,
    };
  }

  /**
   * 拉取云文档全部评论（分页拉全，含回复）。
   * file_type：新版文档 docx / 旧版文档 doc / 电子表格 sheet。
   * 失败（未开评论读权限、文档无权限等）抛错，由调用方降级。
   */
  async listComments(
    fileToken: string,
    fileType: 'docx' | 'doc' | 'sheet' = 'docx',
  ): Promise<FeishuComment[]> {
    const all: FeishuComment[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: RawComment[];
        has_more: boolean;
        page_token?: string;
      }>('GET', `/drive/v1/files/${fileToken}/comments`, {
        params: {
          file_type: fileType,
          user_id_type: 'open_id',
          page_size: 100,
          page_token: pageToken,
        },
      });
      for (const raw of data.items ?? []) {
        const replies = (raw.reply_list?.replies ?? []).map((r) =>
          this.mapCommentReply(r),
        );
        const seconds = Number(raw.create_time);
        all.push({
          userId: raw.user_id ?? null,
          createTime: Number.isFinite(seconds) ? seconds : null,
          isSolved: !!raw.is_solved,
          isWhole: raw.is_whole !== false,
          quote: raw.quote?.trim() ?? '',
          replies,
        });
      }
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return all;
  }

  /** 评论人 open_id → 姓名缓存（跨同步复用；外部用户/无权限时回退显示 open_id） */
  private readonly commentUserNameCache = new Map<string, string>();

  /** 批量解析评论/回复人姓名（逐个补查，失败静默跳过） */
  private async resolveCommentUserNames(
    comments: FeishuComment[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const comment of comments) {
      if (comment.userId) ids.add(comment.userId);
      for (const reply of comment.replies) {
        if (reply.userId) ids.add(reply.userId);
      }
    }
    const pending = [...ids].filter((id) => !this.commentUserNameCache.has(id));
    await Promise.all(
      pending.map(async (id, index) => {
        try {
          // 错峰请求，避免通讯录接口频控
          await new Promise((resolve) => setTimeout(resolve, index * 100));
          const user = await this.getContactUser(id);
          if (user.name) this.commentUserNameCache.set(id, user.name);
        } catch {
          /* 外部用户或缺少通讯录读权限：保留 open_id 展示 */
        }
      }),
    );
    const names = new Map<string, string>();
    for (const id of ids) {
      const name = this.commentUserNameCache.get(id);
      if (name) names.set(id, name);
    }
    return names;
  }

  /**
   * 文档评论 → Markdown 片段（追加到正文末尾）。
   * 评论导入为增强能力：无权限/接口失败只告警，返回空串，绝不阻断文档同步。
   */
  private async docxCommentsMarkdown(
    documentId: string,
    fileType: 'docx' | 'doc',
  ): Promise<string> {
    try {
      const comments = await this.listComments(documentId, fileType);
      if (comments.length === 0) return '';
      const names = await this.resolveCommentUserNames(comments);
      return feishuCommentsToMarkdown(comments, names);
    } catch (e) {
      this.logger.warn(
        `飞书评论导入失败 ${documentId}: ${(e as Error).message}（需评论读权限 docs:document.comment:read / docs:doc:readonly）`,
      );
      return '';
    }
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

  /** 多维表格字段元信息（分页拉全；含 property，如 SingleLink 字段的关联 table_id） */
  async listBitableFields(
    appToken: string,
    tableId: string,
  ): Promise<BitableFieldMeta[]> {
    const all: BitableFieldMeta[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: BitableFieldMeta[];
        has_more: boolean;
        page_token?: string;
      }>('GET', `/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
        params: { page_size: 100, page_token: pageToken },
      });
      all.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return all;
  }

  /** 按 record_id 批量取多维表格记录（按 100 分片）。用于解析 SingleLink 关联记录的名称 */
  async batchGetBitableRecords(
    appToken: string,
    tableId: string,
    recordIds: string[],
  ): Promise<BitableRecord[]> {
    const all: BitableRecord[] = [];
    for (let i = 0; i < recordIds.length; i += 100) {
      const data = await this.request<{ records?: BitableRecord[] }>(
        'POST',
        `/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_get`,
        { data: { record_ids: recordIds.slice(i, i + 100) } },
      );
      all.push(...(data.records ?? []));
    }
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

  /**
   * 全量部门列表（分页拉全，open_department_id 维度）。
   * 需应用具备通讯录读权限；返回空数组表示无可见部门。
   */
  async listAllDepartments(): Promise<
    { openDepartmentId: string; name: string }[]
  > {
    const all: { openDepartmentId: string; name: string }[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: { open_department_id?: string; name?: string }[];
        has_more: boolean;
        page_token?: string;
      }>('GET', '/contact/v3/departments', {
        params: {
          page_size: 50,
          department_id_type: 'open_department_id',
          page_token: pageToken,
        },
      });
      for (const d of data.items ?? []) {
        if (d.open_department_id) {
          all.push({
            openDepartmentId: d.open_department_id,
            name: d.name ?? '',
          });
        }
      }
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return all;
  }

  /** 某个部门的直接成员 open_id 列表（分页拉全，不含子部门） */
  async listDepartmentMembers(openDepartmentId: string): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const data = await this.request<{
        items?: { open_id?: string }[];
        has_more: boolean;
        page_token?: string;
      }>('GET', '/contact/v3/users/find_by_department', {
        params: {
          department_id: openDepartmentId,
          department_id_type: 'open_department_id',
          user_id_type: 'open_id',
          page_size: 50,
          page_token: pageToken,
        },
      });
      for (const u of data.items ?? []) {
        if (u.open_id) ids.push(u.open_id);
      }
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return ids;
  }

  /** 用户详情（姓名/union_id/头像/部门，avatar 优先原图，缺失逐级降级） */
  async getContactUser(openId: string): Promise<FeishuContactUserDetail> {
    const data = await this.request<{ user?: FeishuContactUserDetail }>(
      'GET',
      `/contact/v3/users/${openId}`,
      {
        params: {
          user_id_type: 'open_id',
          department_id_type: 'open_department_id',
        },
      },
    );
    return data.user ?? {};
  }

  /**
   * 全量通讯录用户（遍历所有部门成员去重 → 逐人取详情补全 union_id/头像/主部门）。
   * 供用户系统全量同步使用；单部门/单用户失败仅告警跳过，不阻断整体。
   * 仅返回姓名/头像/部门等基础信息（邮箱/手机需额外权限，未取）。
   */
  async listAllUsers(): Promise<FeishuContactUser[]> {
    const departments = await this.listAllDepartments();
    const deptName = new Map(
      departments.map((d) => [d.openDepartmentId, d.name]),
    );
    const openIds = new Set<string>();
    for (const dept of departments) {
      try {
        const members = await this.listDepartmentMembers(dept.openDepartmentId);
        for (const id of members) openIds.add(id);
      } catch (e) {
        this.logger.warn(
          `拉取部门成员失败 ${dept.name}（${dept.openDepartmentId}）: ${(e as Error).message}`,
        );
      }
    }
    const users: FeishuContactUser[] = [];
    for (const openId of openIds) {
      try {
        const detail = await this.getContactUser(openId);
        const primaryId =
          detail.orders?.find((o) => o.is_primary_dept)?.department_id ??
          detail.department_ids?.[0] ??
          null;
        users.push({
          openId,
          unionId: detail.union_id ?? null,
          name: detail.name ?? openId,
          avatarUrl:
            detail.avatar?.avatar_origin ??
            detail.avatar?.avatar_640 ??
            detail.avatar?.avatar_240 ??
            null,
          department: primaryId ? (deptName.get(primaryId) ?? null) : null,
        });
      } catch (e) {
        this.logger.warn(`拉取用户详情失败 ${openId}: ${(e as Error).message}`);
      }
    }
    return users;
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

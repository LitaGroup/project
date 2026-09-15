import { BadRequestException, Injectable } from '@nestjs/common';
import axios from 'axios';

/** apipost 链接解析结果：projectId 为 apipost 侧项目 id，两种链接格式均包含 */
export interface ApipostUrlRef {
  projectId: string;
  /** 规范化原文链接（docs 页面，剔除 target_id/locale 等查询参数），兼作同步判重 key */
  docsUrl: string;
  /** swagger JSON 拉取地址（由 projectId 派生） */
  swaggerUrl: string;
}

export interface ApipostReadResult {
  projectId: string;
  docsUrl: string;
  /** 文档标题，取 swagger info.title */
  title: string;
  /** 原始 swagger JSON 字符串（存 Document.content） */
  rawJson: string;
}

export const APIPOST_DOCS_PATTERN =
  /docs\.apipost\.net\/docs\/detail\/([A-Za-z0-9]+)/;
export const APIPOST_SWAGGER_PATTERN =
  /openapi\.apipost\.net\/swagger\/v3\/([A-Za-z0-9]+)/;

/**
 * 解析 apipost 链接（docs 页面 / swagger JSON 两种格式均可），
 * 规范化为固定形式的原文链接与 swagger 地址；非法链接 400。
 */
export function parseApipostUrl(url: string): ApipostUrlRef {
  const match =
    APIPOST_DOCS_PATTERN.exec(url) ?? APIPOST_SWAGGER_PATTERN.exec(url);
  if (!match) {
    throw new BadRequestException(
      '不是有效的 APIPOST 链接（支持 docs.apipost.net 文档页或 openapi.apipost.net swagger 链接）',
    );
  }
  const projectId = match[1];
  return {
    projectId,
    docsUrl: `https://docs.apipost.net/docs/detail/${projectId}`,
    swaggerUrl: `https://openapi.apipost.net/swagger/v3/${projectId}`,
  };
}

/** APIPOST 开放客户端：swagger JSON 公开可访问，无需鉴权 */
@Injectable()
export class ApipostService {
  /** 拉取 swagger JSON，返回规范化原文链接、标题与原始 JSON 字符串 */
  async readByUrl(url: string): Promise<ApipostReadResult> {
    const ref = parseApipostUrl(url);
    let data: unknown;
    try {
      const res = await axios.get<unknown>(ref.swaggerUrl, {
        timeout: 30_000,
      });
      data = res.data;
    } catch (e) {
      throw new BadRequestException(
        `APIPOST swagger 拉取失败：${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (
      !data ||
      typeof data !== 'object' ||
      Array.isArray(data) ||
      typeof (data as { paths?: unknown }).paths !== 'object'
    ) {
      throw new BadRequestException(
        '链接返回的不是有效的 APIPOST swagger 内容',
      );
    }
    const info = (data as { info?: { title?: unknown } }).info;
    const title =
      typeof info?.title === 'string' && info.title.trim()
        ? info.title.trim()
        : `APIPOST ${ref.projectId}`;
    return {
      projectId: ref.projectId,
      docsUrl: ref.docsUrl,
      title: title.slice(0, 200),
      rawJson: JSON.stringify(data),
    };
  }
}

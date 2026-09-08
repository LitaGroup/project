import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** word/sheet 接口响应：status=0 成功；data 为 语种 → (key → 文案) 的映射 */
interface WordSheetResponse {
  status: number;
  msg: string;
  data: Record<string, Record<string, string>> | null;
}

/**
 * 多语言文案读取客户端：调 Lita 平台接口 `POST {LITA_API_HOST}/basic-common/v1/word/sheet`
 * （body `{sheet: "SHEET$NAMESPACE"}`）拉取固定 Google Sheet 内某前缀下的全部文案，
 * 输出统一为 Markdown 表格缓存到资源 content。
 * 注意：该接口失败也返回 HTTP 200，须看响应体 status（0 为成功）。
 */
@Injectable()
export class WordSheetService {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    const host =
      config.get<string>('LITA_API_HOST') ?? 'https://api.cinta.team';
    this.baseUrl = host.replace(/\/+$/, '');
  }

  /** 按前缀读取多语言文案，返回 Markdown 表格（列：key + 各语种） */
  async readSheetMarkdown(sheet: string): Promise<string> {
    let body: WordSheetResponse;
    try {
      const res = await axios.post<WordSheetResponse>(
        `${this.baseUrl}/basic-common/v1/word/sheet`,
        { sheet },
        { timeout: 30_000 },
      );
      body = res.data;
    } catch (e) {
      throw new BadGatewayException(
        `多语言接口请求失败: ${(e as Error).message}`,
      );
    }
    if (body?.status !== 0) {
      throw new BadRequestException(
        `多语言接口返回错误（${sheet}）: ${body?.msg || '未知错误'}`,
      );
    }
    const byLang = body.data ?? {};
    const languages = Object.keys(byLang);
    if (languages.length === 0) return '（该前缀下无文案）';
    const keys = [...new Set(languages.flatMap((l) => Object.keys(byLang[l])))];
    keys.sort();
    const cell = (v: string | undefined) =>
      (v ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
    const header = `| key | ${languages.join(' | ')} |`;
    const divider = `| --- | ${languages.map(() => '---').join(' | ')} |`;
    const rows = keys.map(
      (k) =>
        `| ${cell(k)} | ${languages.map((l) => cell(byLang[l]?.[k])).join(' | ')} |`,
    );
    return [
      `共 ${keys.length} 条文案 × ${languages.length} 语种（${languages.join('、')}）`,
      '',
      header,
      divider,
      ...rows,
    ].join('\n');
  }
}

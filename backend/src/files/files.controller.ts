import {
  BadRequestException,
  Controller,
  Header,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { mdFrontmatter } from '../common/frontmatter';
import { fileWebroot } from '../common/paths';

/** 单文件大小上限 50MB */
const MAX_SIZE = 50 * 1024 * 1024;

/**
 * 通用文件上传：供 Agent 上传任意文件并获取公共访问地址。
 * 文件存 fileWebroot()/{YYYYMMDD}/{uuid}{ext}，经 main.ts 静态挂载的 /files 对外访问。
 */
@Controller('files')
export class FilesController {
  constructor(private readonly config: ConfigService) {}

  @Post('upload.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<string> {
    if (!file) {
      throw new BadRequestException('缺少上传文件（multipart 字段名 file）');
    }

    const filename =
      path.posix.basename(
        sanitizeText(file.originalname).replace(/\\/g, '/'),
      ) || '未命名文件';
    const ext = safeExtension(filename);
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const relPath = path.posix.join(date, `${randomUUID()}${ext}`);
    const absPath = path.join(fileWebroot(), relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.buffer);

    const appUrl = (
      this.config.get<string>('APP_URL') ?? 'http://localhost:5273'
    ).replace(/\/+$/, '');
    const url = `${appUrl}/files/${relPath}`;

    return [
      mdFrontmatter({
        title: '文件上传成功',
        filename,
        url,
      }),
      '# 文件上传成功',
      '',
      `- 文件名：${escapeMarkdown(filename)}`,
      `- 大小：${formatSize(file.size)}`,
      `- 类型：${escapeMarkdown(sanitizeText(file.mimetype) || '未知')}`,
      `- 公开地址：${url}`,
      '',
      '该地址无需登录或 Token 即可公开访问。',
      '',
    ].join('\n');
  }
}

/** 文件名/MIME 展示前折叠换行，避免破坏 Markdown 与 frontmatter */
function sanitizeText(value: string | undefined): string {
  return (value ?? '').replace(/[\r\n]+/g, ' ').trim();
}

/** 转义 Markdown 语法与内联 HTML，避免用户文件名/类型注入链接或标签 */
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');
}

/** 仅保留常规扩展名，未知或含特殊字符时省略，避免生成异常路径 */
function safeExtension(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{1,16}$/.test(ext) ? ext : '';
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { imageWebroot } from '../common/paths';

/** 允许的图片扩展名 */
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
/** MIME → 扩展名（原文件名无扩展名时兜底） */
const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};
/** 单文件大小上限 10MB */
const MAX_SIZE = 10 * 1024 * 1024;

/**
 * 图片上传：供缺陷正文等 Markdown 内容内嵌图片使用。
 * 存 imageWebroot()/uploads/{YYYYMMDD}/{uuid}.{ext}，返回 /images/... 链接
 * （由 main.ts 静态挂载对外访问）。
 */
@Controller('images')
export class ImagesController {
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  async upload(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ path: string; url: string }> {
    if (!file) {
      throw new BadRequestException('缺少上传文件（multipart 字段名 file）');
    }
    const ext =
      path.extname(file.originalname ?? '').toLowerCase() ||
      MIME_EXT[file.mimetype] ||
      '';
    if (!ALLOWED_EXT.has(ext)) {
      throw new BadRequestException('仅支持图片文件（png/jpg/jpeg/gif/webp）');
    }
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const relDir = path.posix.join('uploads', date);
    const relPath = path.posix.join(relDir, `${randomUUID()}${ext}`);
    const absPath = path.join(imageWebroot(), relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, file.buffer);
    return { path: relPath, url: `/images/${relPath}` };
  }
}

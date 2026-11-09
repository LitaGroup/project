import {
  Controller,
  Header,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FILE_UPLOAD_MAX_SIZE, FilesService } from './files.service';

/**
 * 通用文件上传：供 Agent / 网页聊天上传任意文件并获取公共访问地址。
 * - POST /api/files：JSON（网页聊天附件）
 * - POST /api/files/upload.md：Markdown（Agent 技能；lita-work MCP 已提供 upload_file）
 */
@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /** 网页用 JSON 上传：返回文件名/大小/类型/公开地址 */
  @Post()
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: FILE_UPLOAD_MAX_SIZE } }),
  )
  uploadJson(@UploadedFile() file?: Express.Multer.File) {
    return this.filesService.store(file);
  }

  @Post('upload.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: FILE_UPLOAD_MAX_SIZE } }),
  )
  async upload(@UploadedFile() file?: Express.Multer.File): Promise<string> {
    return this.filesService.renderMarkdown(
      await this.filesService.store(file),
    );
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { FILE_UPLOAD_MAX_SIZE, FilesService } from '../../files/files.service';
import { executeTool, markdownResult } from './work-tools.util';
import type { McpWorkPrincipal, WorkToolRegistrar } from './work-tools.types';

/** 文件上传（MCP 无 multipart，改用 base64 内容） */
@Injectable()
export class WorkFileTools implements WorkToolRegistrar {
  private readonly logger = new Logger(WorkFileTools.name);

  constructor(private readonly files: FilesService) {}

  register(server: McpServer, principal: McpWorkPrincipal): void {
    server.registerTool(
      'upload_file',
      {
        title: '上传文件',
        description:
          '上传任意文件（≤50MB）到平台并返回无需登录的公共 URL。content_base64 为文件内容 base64（可带 data URL 前缀）；不要上传密钥等敏感文件。',
        inputSchema: {
          filename: z
            .string()
            .min(1)
            .describe('原始文件名（含扩展名，如 report.pdf）'),
          content_base64: z
            .string()
            .min(1)
            .describe('文件内容 base64（可带 data:<mime>;base64, 前缀）'),
          mime_type: z
            .string()
            .optional()
            .describe('MIME 类型（缺省 application/octet-stream）'),
        },
      },
      async (args) =>
        executeTool(this.logger, 'upload_file', principal, async () => {
          const base64 = args.content_base64.replace(
            /^data:[^;,]*;base64,/i,
            '',
          );
          const buffer = Buffer.from(base64, 'base64');
          if (buffer.length === 0) {
            throw new BadRequestException('content_base64 解码后为空');
          }
          if (buffer.length > FILE_UPLOAD_MAX_SIZE) {
            throw new BadRequestException(
              `文件超过 ${FILE_UPLOAD_MAX_SIZE / 1024 / 1024}MB 上限`,
            );
          }
          const stored = await this.files.store({
            originalname: args.filename,
            mimetype: args.mime_type || 'application/octet-stream',
            size: buffer.length,
            buffer,
          });
          return markdownResult(this.files.renderMarkdown(stored));
        }),
    );
  }
}

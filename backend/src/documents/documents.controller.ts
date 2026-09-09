import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { DocumentType } from '../common/enums';
import { Document } from './document.entity';
import { DocumentsService } from './documents.service';

class CreateMarkdownDocumentDto {
  projectId: number;
  title: string;
  type: DocumentType;
  content?: string;
}

class SyncFeishuDocumentDto {
  projectId: number;
  type: DocumentType;
  url: string;
  /** 文档描述，可不填 */
  description?: string;
}

class UpsertDocumentDto {
  projectId: number;
  /** AI 写入文档的判重标识，项目内唯一（如 'deploy-guide.md'） */
  fileName: string;
  /** 展示标题；新建时不填默认取 fileName，更新时不填保持原样 */
  title?: string;
  /** 新建时不填默认"技术"，更新时不填保持原样 */
  type?: DocumentType;
  content: string;
  /** 文档描述，可不填（更新时不填保持原样） */
  description?: string;
}

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /** 文档列表：传 projectId 按项目过滤，不传返回全部 */
  @Get()
  findByProject(@Query('projectId') projectId?: string): Promise<Document[]> {
    return this.documentsService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  /** Markdown 视图（须声明在 :id 之前，避免 :id 匹配到带 .md 后缀的路径） */
  @Get(':id.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  findOneMarkdown(@Param('id', ParseIntPipe) id: number): Promise<string> {
    return this.documentsService.findOneMarkdown(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<Document> {
    return this.documentsService.findOne(id);
  }

  @Post()
  createMarkdown(@Body() dto: CreateMarkdownDocumentDto): Promise<Document> {
    return this.documentsService.createMarkdown(dto);
  }

  /** 一键同步飞书文档（单向导入） */
  @Post('sync-feishu')
  syncFromFeishu(@Body() dto: SyncFeishuDocumentDto): Promise<Document> {
    return this.documentsService.syncFromFeishu(dto);
  }

  /**
   * AI 文档 upsert：按 (projectId, fileName) 判重，存在则更新正文、不存在则新建。
   * text/markdown 返回结果（含文档阅读地址）。
   */
  @Post('upsert.md')
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async upsert(@Body() dto: UpsertDocumentDto): Promise<string> {
    const { doc, created } = await this.documentsService.upsert(dto);
    return [
      `# 文档已${created ? '创建' : '更新'}`,
      '',
      `- ID：${doc.id}`,
      `- 项目：${doc.projectId}`,
      `- fileName：${doc.fileName}`,
      `- 标题：${doc.title}`,
      `- 类型：${doc.type}`,
      `- 阅读地址：GET /api/documents/${doc.id}.md`,
      '',
    ].join('\n');
  }

  @Patch(':id/content')
  updateContent(
    @Param('id', ParseIntPipe) id: number,
    @Body('content') content: string,
  ): Promise<Document> {
    return this.documentsService.updateContent(id, content);
  }

  /** 更新备注（为后续 AI 阅读准备），飞书文档也可编辑备注 */
  @Patch(':id/remark')
  updateRemark(
    @Param('id', ParseIntPipe) id: number,
    @Body('remark') remark: string,
  ): Promise<Document> {
    return this.documentsService.updateRemark(id, remark);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.documentsService.remove(id);
  }
}

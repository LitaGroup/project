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

@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get()
  findByProject(
    @Query('projectId', ParseIntPipe) projectId: number,
  ): Promise<Document[]> {
    return this.documentsService.findByProject(projectId);
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

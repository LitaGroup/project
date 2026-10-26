import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthedRequest } from '../auth/auth.guard';
import { KnowledgeService } from './knowledge.service';
import type { KnowledgeSearchSource } from './knowledge.types';

class CreateKnowledgeNodeDto {
  kind: 'directory' | 'article';
  parentPath?: string;
  name: string;
  title?: string;
  content?: string;
}

class UpdateKnowledgeNodeDto {
  title?: string;
  content?: string;
  name?: string;
  parentPath?: string;
}

class CreateKnowledgeMarkdownDto {
  kind: 'directory' | 'article';
  parentPath?: string;
  name: string;
  title?: string;
  content?: string;
}

class UpdateKnowledgeMarkdownDto {
  /** 当前知识路径；文章 `/a/b`，目录 `/a/b`（不带结尾 /） */
  path: string;
  title?: string;
  content?: string;
  name?: string;
  parentPath?: string;
}

class DeleteKnowledgeMarkdownDto {
  path: string;
  /** 删除非空目录时必须显式传 true */
  recursive?: boolean;
}

function requestPathname(req: Request): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0];
}

/** 从原始 URL 截取 detail 后缀，并拒绝编码斜杠（避免一个路径段被当作多级目录） */
function detailSuffix(req: Request): string {
  const prefix = '/api/docs/detail';
  const pathname = requestPathname(req);
  if (pathname === prefix) return '';
  if (!pathname.startsWith(`${prefix}/`)) {
    throw new BadRequestException('知识路径不合法');
  }
  const raw = pathname.slice(prefix.length + 1);
  if (/%2f|%5c/i.test(raw)) {
    throw new BadRequestException('知识路径不能包含编码后的斜杠或反斜杠');
  }
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new BadRequestException('知识路径编码不合法');
  }
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

@Controller('docs')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  private async handleDetail(req: Request, res: Response): Promise<unknown> {
    const suffix = detailSuffix(req);
    const markdown = suffix.endsWith('.md');
    let rawPath = suffix;
    let directory = suffix === '' || suffix.endsWith('/');
    if (markdown) {
      if (suffix === '.md' || suffix.endsWith('/.md')) {
        rawPath = suffix.endsWith('/.md') ? suffix.slice(0, -4) : '';
        directory = true;
      } else {
        rawPath = suffix.slice(0, -3);
      }
    }
    const path = rawPath.replace(/^\/+/, '').replace(/\/+$/, '')
      ? `/${rawPath.replace(/^\/+/, '').replace(/\/+$/, '')}`
      : '/';

    if (markdown) {
      res.type('text/markdown; charset=utf-8');
      return directory
        ? this.knowledge.renderDirectoryMarkdown(path)
        : this.knowledge.renderArticleMarkdown(
            await this.knowledge.readArticle(path),
          );
    }

    if (directory) {
      return this.knowledge.readDirectory(path);
    }
    return this.knowledge.readArticle(path);
  }

  @Get('detail')
  detailRoot(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.handleDetail(req, res);
  }

  @Get('detail/{*path}')
  detail(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    return this.handleDetail(req, res);
  }

  @Get('search.md')
  async searchMarkdown(
    @Req() req: Request,
    @Query('q') q: string,
    @Query('source') source?: string,
    @Query('path') path?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ): Promise<string> {
    const user = (req as AuthedRequest).user;
    if (!user) throw new BadRequestException('缺少登录用户');
    const result = await this.knowledge.search({
      query: q,
      source: (source ?? 'project') as KnowledgeSearchSource,
      path,
      page: optionalNumber(page),
      pageSize: optionalNumber(pageSize) ?? optionalNumber(limit),
      userId: user.id,
    });
    return this.knowledge.renderSearchMarkdown(result);
  }

  @Get('search')
  async search(
    @Req() req: Request,
    @Query('q') q: string,
    @Query('source') source?: string,
    @Query('path') path?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    const user = (req as AuthedRequest).user;
    if (!user) throw new BadRequestException('缺少登录用户');
    return this.knowledge.search({
      query: q,
      source: (source ?? 'project') as KnowledgeSearchSource,
      path,
      page: optionalNumber(page),
      pageSize: optionalNumber(pageSize) ?? optionalNumber(limit),
      userId: user.id,
    });
  }

  @Get('nodes/:id')
  getNode(@Param('id') id: string) {
    return this.knowledge.getNodeById(id);
  }

  /** AI 创建知识文章/目录（Markdown 返回，便于直接进入后续操作） */
  @Post('nodes/create.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async createMarkdown(
    @Body() dto: CreateKnowledgeMarkdownDto,
  ): Promise<string> {
    if (dto.kind !== 'directory' && dto.kind !== 'article') {
      throw new BadRequestException('kind 只能是 directory 或 article');
    }
    const node = await this.knowledge.create({
      kind: dto.kind,
      parentPath: dto.parentPath ?? '/',
      name: dto.name,
      title: dto.title,
      content: dto.content,
    });
    return this.knowledge.renderNodeCreatedMarkdown(node);
  }

  /** AI 更新文章正文/标题，或移动/重命名文章与目录 */
  @Post('nodes/update.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async updateMarkdown(
    @Body() dto: UpdateKnowledgeMarkdownDto,
  ): Promise<string> {
    if (!dto.path?.trim()) throw new BadRequestException('path 不能为空');
    const current = await this.knowledge.getNodeByPath(dto.path);
    const node = await this.knowledge.update(current.id, {
      title: dto.title,
      content: dto.content,
      name: dto.name,
      parentPath: dto.parentPath,
    });
    return this.knowledge.renderNodeUpdatedMarkdown(node, current.path);
  }

  /** AI 删除知识文章；非空目录须 recursive=true */
  @Post('nodes/delete.md')
  @HttpCode(200)
  @Header('Content-Type', 'text/markdown; charset=utf-8')
  async deleteMarkdown(
    @Body() dto: DeleteKnowledgeMarkdownDto,
  ): Promise<string> {
    if (!dto.path?.trim()) throw new BadRequestException('path 不能为空');
    const recursive = dto.recursive === true;
    const node = await this.knowledge.getNodeByPath(dto.path);
    await this.knowledge.remove(node.id, recursive);
    return this.knowledge.renderNodeDeletedMarkdown(node, recursive);
  }

  @Post('nodes')
  create(@Body() dto: CreateKnowledgeNodeDto) {
    if (dto.kind !== 'directory' && dto.kind !== 'article') {
      throw new BadRequestException('kind 只能是 directory 或 article');
    }
    return this.knowledge.create({
      kind: dto.kind,
      parentPath: dto.parentPath ?? '/',
      name: dto.name,
      title: dto.title,
      content: dto.content,
    });
  }

  @Patch('nodes/:id')
  update(@Param('id') id: string, @Body() dto: UpdateKnowledgeNodeDto) {
    return this.knowledge.update(id, dto);
  }

  @Delete('nodes/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Query('recursive') recursive?: string,
  ): Promise<void> {
    await this.knowledge.remove(id, recursive === 'true');
  }
}

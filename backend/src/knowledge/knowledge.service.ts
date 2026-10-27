import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { mdFrontmatter } from '../common/frontmatter';
import { KnowledgeEmbeddingService } from './knowledge-embedding.service';
import {
  encodeKnowledgePath,
  normalizeKnowledgePath,
  projectDocumentPath,
} from './knowledge.path';
import { KnowledgeStore } from './knowledge.store';
import type {
  KnowledgeDirectory,
  KnowledgeNode,
  KnowledgeSearchResponse,
  KnowledgeSearchSource,
} from './knowledge.types';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly store: KnowledgeStore,
    private readonly embedding: KnowledgeEmbeddingService,
  ) {}

  get isEnabled(): boolean {
    return this.store.isEnabled;
  }

  get isConfigured(): boolean {
    return this.store.isConfigured;
  }

  get disabledMessage(): string {
    return this.store.unavailableMessage;
  }

  assertEnabled(): void {
    if (!this.store.isEnabled) {
      throw new ServiceUnavailableException(this.store.unavailableMessage);
    }
  }

  private badPath(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    throw new BadRequestException(message);
  }

  private normalize(path: string): string {
    try {
      return normalizeKnowledgePath(path).path;
    } catch (error) {
      return this.badPath(error);
    }
  }

  async getNodeById(id: string): Promise<KnowledgeNode> {
    this.assertEnabled();
    const node = await this.store.getById(id);
    if (!node) throw new NotFoundException('知识节点不存在');
    return node;
  }

  async readDirectory(path: string): Promise<KnowledgeDirectory> {
    this.assertEnabled();
    const normalized = this.normalize(path);
    if (normalized !== '/') {
      const node = await this.store.getByPath(normalized);
      if (!node) throw new NotFoundException(`目录 ${normalized} 不存在`);
      if (node.kind !== 'directory') {
        throw new NotFoundException(`${normalized} 是文章，不是目录`);
      }
    }
    return this.store.listChildren(normalized);
  }

  async readArticle(path: string): Promise<KnowledgeNode> {
    this.assertEnabled();
    const normalized = this.normalize(path);
    if (normalized === '/') throw new NotFoundException('根路径是目录');
    const node = await this.store.getByPath(normalized);
    if (!node) throw new NotFoundException(`文章 ${normalized} 不存在`);
    if (node.kind !== 'article') {
      throw new NotFoundException(`${normalized} 是目录，不是文章`);
    }
    return node;
  }

  /** 按路径取任意知识节点（文章或目录），供 AI 更新/删除定位 */
  async getNodeByPath(path: string): Promise<KnowledgeNode> {
    this.assertEnabled();
    const normalized = this.normalize(path);
    if (normalized === '/') {
      throw new BadRequestException('根目录不能修改或删除');
    }
    const node = await this.store.getByPath(normalized);
    if (!node) throw new NotFoundException(`知识 ${normalized} 不存在`);
    return node;
  }

  async create(input: {
    kind: 'directory' | 'article';
    parentPath: string;
    name: string;
    title?: string;
    content?: string;
  }): Promise<KnowledgeNode> {
    this.assertEnabled();
    const parent = this.normalize(input.parentPath || '/');
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('名称不能为空');
    const path = parent === '/' ? `/${name}` : `${parent}/${name}`;
    let normalized: string;
    try {
      normalized = normalizeKnowledgePath(path).path;
    } catch (error) {
      return this.badPath(error);
    }
    this.assertNativePath(normalized);
    const parentNode =
      parent === '/' ? null : await this.store.getByPath(parent);
    if (parent !== '/' && (!parentNode || parentNode.kind !== 'directory')) {
      throw new BadRequestException(`父目录 ${parent} 不存在`);
    }
    try {
      return await this.store.createNode({
        kind: input.kind,
        path: normalized,
        title: input.title,
        content: input.kind === 'article' ? (input.content ?? '') : undefined,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException(`路径 ${normalized} 已存在`);
      }
      throw this.storeError(error);
    }
  }

  async update(
    id: string,
    input: {
      title?: string;
      content?: string;
      name?: string;
      parentPath?: string;
    },
  ): Promise<KnowledgeNode> {
    this.assertEnabled();
    if (
      input.title === undefined &&
      input.content === undefined &&
      input.name === undefined &&
      input.parentPath === undefined
    ) {
      throw new BadRequestException(
        '至少提供一个更新字段：title/content/name/parentPath',
      );
    }
    const current = await this.getNodeById(id);
    if (current.source !== 'native') {
      throw new ForbiddenException('项目同步或系统知识为只读');
    }
    if (input.parentPath !== undefined) {
      const parent = this.normalize(input.parentPath);
      this.assertNativePath(parent);
      if (parent !== '/') {
        const parentNode = await this.store.getByPath(parent);
        if (!parentNode || parentNode.kind !== 'directory') {
          throw new BadRequestException(`父目录 ${parent} 不存在`);
        }
      }
    }
    try {
      return await this.store.updateNode(id, input);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BadRequestException('目标路径已存在');
      }
      throw this.storeError(error);
    }
  }

  async remove(id: string, recursive = false): Promise<void> {
    this.assertEnabled();
    const node = await this.getNodeById(id);
    if (node.source !== 'native') {
      throw new ForbiddenException('项目同步或系统知识为只读');
    }
    try {
      await this.store.deleteNode(id, recursive);
    } catch (error) {
      throw this.storeError(error);
    }
  }

  private assertNativePath(path: string): void {
    if (path === '/project' || path.startsWith('/project/')) {
      throw new ForbiddenException('/project 为项目文档保留路径，不能手工维护');
    }
  }

  private storeError(error: unknown): Error {
    if (isUniqueViolation(error)) {
      return new BadRequestException('路径已存在');
    }
    if (
      error instanceof BadRequestException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    ) {
      return error;
    }
    return new BadRequestException(
      error instanceof Error ? error.message : String(error),
    );
  }

  /** 项目文档同步入口；知识库未配置时返回 false，由文档模块保持 业务库兼容存储 */
  async upsertProjectDocument(input: {
    projectId: number;
    documentId: number;
    title: string;
    content: string;
  }): Promise<boolean> {
    if (!this.store.isEnabled) return false;
    const node = await this.store.upsertProjectDocument(input);
    this.logger.log(
      `项目文档已同步到知识库：${node.path}（${node.content?.length ?? 0} 字）`,
    );
    return true;
  }

  async removeProjectDocument(documentId: number): Promise<void> {
    if (!this.store.isEnabled) return;
    await this.store.deleteDocumentNode(documentId);
  }

  async removeProject(projectId: number): Promise<void> {
    if (!this.store.isEnabled) return;
    await this.store.deleteProject(projectId);
  }

  async getProjectDocument(
    projectId: number,
    documentId: number,
  ): Promise<KnowledgeNode | null> {
    if (!this.store.isEnabled) return null;
    return this.store.getByPath(projectDocumentPath(projectId, documentId));
  }

  projectDocumentMdUrl(projectId: number, documentId: number): string {
    const path = projectDocumentPath(projectId, documentId);
    return `/api/docs/detail${encodeKnowledgePath(path)}.md`;
  }

  async search(input: {
    query: string;
    source?: KnowledgeSearchSource;
    path?: string;
    page?: number;
    pageSize?: number;
  }): Promise<KnowledgeSearchResponse> {
    const source = input.source ?? 'project';
    if (source !== 'project') {
      throw new BadRequestException(
        '飞书云文档搜索已下线，source 仅支持 project（站内知识）',
      );
    }
    const q = input.query?.trim();
    if (!q) throw new BadRequestException('搜索关键词不能为空');
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 8;
    if (!Number.isInteger(page) || page < 1) {
      throw new BadRequestException('page 必须是大于等于 1 的整数');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('pageSize 必须是 1..100 的整数');
    }
    if (q.length > 500) {
      throw new BadRequestException('搜索关键词不能超过 500 字');
    }
    this.assertEnabled();
    const offset = (page - 1) * pageSize;
    const path = this.normalize(input.path || '/');
    if (path !== '/') {
      const node = await this.store.getByPath(path);
      if (!node || node.kind !== 'directory') {
        throw new BadRequestException(`搜索目录 ${path} 不存在`);
      }
    }
    let queryVector: number[] | null = null;
    if (this.embedding.configured) {
      try {
        queryVector = await this.embedding.embedOne(q);
      } catch (error) {
        this.logger.warn(
          `查询向量生成失败，降级为全文检索：${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    const retrieval = await this.store.search({
      query: q,
      path,
      offset,
      limit: pageSize,
      queryVector,
    });
    return {
      query: q,
      source,
      path,
      page,
      pageSize,
      mode: retrieval.mode,
      results: retrieval.results,
      project: {
        page,
        pageSize,
        hasMore: retrieval.hasMore,
        mode: retrieval.mode,
        results: retrieval.results,
      },
    };
  }

  async renderDirectoryMarkdown(path: string): Promise<string> {
    const dir = await this.readDirectory(path);
    const encoded = encodeKnowledgePath(dir.path);
    const uiBase = encoded ? `/docs/detail/${encoded}` : '/docs/detail';
    const crumbs: string[] = [];
    if (dir.path !== '/') {
      const segments = normalizeKnowledgePath(dir.path).segments;
      segments.forEach((segment, i) => {
        const crumbPath = `/${segments.slice(0, i + 1).join('/')}`;
        crumbs.push(
          `[${segment}](/api/docs/detail/${encodeKnowledgePath(crumbPath)}/.md)`,
        );
      });
    }
    const lines = [
      mdFrontmatter({
        update: new Date(),
        title: dir.path === '/' ? '知识库' : dir.path,
        path: dir.path,
        type: 'directory',
      }),
      `# ${dir.path === '/' ? '知识库' : dir.path}`,
      '',
      crumbs.length ? `路径：${crumbs.join(' / ')}` : '路径：根目录',
      '',
      '## 子目录',
      '',
      ...(dir.directories.length
        ? dir.directories.map((node) => {
            const child = encodeKnowledgePath(node.path);
            return `- [${node.title}](/api/docs/detail/${child}/.md)（网页：${uiBase}/${encodeURIComponent(node.name)}/）`;
          })
        : ['（无）']),
      '',
      '## 文章',
      '',
      ...(dir.articles.length
        ? dir.articles.map((node) => {
            const child = encodeKnowledgePath(node.path);
            return `- [${node.title}](/api/docs/detail/${child}.md)（网页：${uiBase}/${encodeURIComponent(node.name)}）`;
          })
        : ['（无）']),
      '',
      '> 上述链接返回直接子级；进入子目录请使用带结尾 `/` 的 `/.md` 地址。',
      '',
    ];
    return lines.join('\n');
  }

  renderArticleMarkdown(node: KnowledgeNode): string {
    return [
      mdFrontmatter({
        update: node.updatedAt,
        title: node.title,
        path: node.path,
        id: node.id,
        source: node.source,
      }),
      node.content ?? '',
      '',
    ].join('\n');
  }

  private nodeReadUrl(node: KnowledgeNode): string {
    const encoded = encodeKnowledgePath(node.path);
    return `/api/docs/detail/${encoded}${node.kind === 'directory' ? '/.md' : '.md'}`;
  }

  private nodeWebUrl(node: KnowledgeNode): string {
    const encoded = encodeKnowledgePath(node.path);
    return `/docs/detail/${encoded}${node.kind === 'directory' ? '/' : ''}`;
  }

  renderNodeCreatedMarkdown(node: KnowledgeNode): string {
    return [
      mdFrontmatter({
        update: node.updatedAt,
        title: node.title,
        path: node.path,
        id: node.id,
        type: node.kind,
      }),
      `# 知识${node.kind === 'directory' ? '目录' : '文章'}已创建`,
      '',
      `- ID：${node.id}`,
      `- 路径：${node.kind === 'directory' ? `${node.path}/` : node.path}`,
      `- 类型：${node.kind === 'directory' ? '目录' : '文章'}`,
      `- 标题：${node.title}`,
      `- 读取：GET ${this.nodeReadUrl(node)}`,
      `- 网页：${this.nodeWebUrl(node)}`,
      ...(node.kind === 'article'
        ? [
            `- 更新：POST /api/docs/nodes/update.md（body.path=${node.path}）`,
            `- 删除：POST /api/docs/nodes/delete.md（body.path=${node.path}）`,
          ]
        : []),
      '',
      '> 项目同步知识位于 /project/**，只读，不能通过上述接口修改或删除。',
      '',
    ].join('\n');
  }

  renderNodeUpdatedMarkdown(node: KnowledgeNode, previousPath: string): string {
    return [
      mdFrontmatter({
        update: node.updatedAt,
        title: node.title,
        path: node.path,
        id: node.id,
        type: node.kind,
      }),
      `# 知识${node.kind === 'directory' ? '目录' : '文章'}已更新`,
      '',
      `- ID：${node.id}`,
      `- 原路径：${previousPath}`,
      `- 当前路径：${node.kind === 'directory' ? `${node.path}/` : node.path}`,
      `- 类型：${node.kind === 'directory' ? '目录' : '文章'}`,
      `- 标题：${node.title}`,
      `- 读取：GET ${this.nodeReadUrl(node)}`,
      `- 网页：${this.nodeWebUrl(node)}`,
      '',
      '> 移动目录时其全部子目录和文章会同步移动，后代文章的向量索引会重建。',
      '',
    ].join('\n');
  }

  renderNodeDeletedMarkdown(node: KnowledgeNode, recursive: boolean): string {
    return [
      mdFrontmatter({
        update: new Date(),
        title: node.title,
        path: node.path,
        id: node.id,
        type: node.kind,
      }),
      `# 知识${node.kind === 'directory' ? '目录' : '文章'}已删除`,
      '',
      `- ID：${node.id}`,
      `- 路径：${node.path}`,
      `- 类型：${node.kind === 'directory' ? '目录' : '文章'}`,
      ...(node.kind === 'directory'
        ? [`- 递归删除：${recursive ? '是' : '否'}`]
        : []),
      '',
      '> 删除不可恢复；项目同步知识不会被此接口删除。',
      '',
    ].join('\n');
  }

  renderSearchMarkdown(result: KnowledgeSearchResponse): string {
    const lines = [
      mdFrontmatter({
        update: new Date(),
        title: `知识搜索：${result.query}`,
        query: result.query,
        source: result.source,
        path: result.path,
        page: result.page,
        pageSize: result.pageSize,
        mode: result.mode,
      }),
      '# 知识搜索结果',
      '',
      `- 关键词：${result.query}`,
      `- 数据源：站内知识（${result.source}）`,
      `- 分页：第 ${result.page} 页，每页最多 ${result.pageSize} 条`,
      `- 站内范围：${result.path}`,
      `- 站内检索模式：${result.mode === 'hybrid' ? '全文 + 向量混合' : '全文'}`,
      `- 站内结果数：${result.results.length}${result.project.hasMore ? '（还有下一页）' : ''}`,
      '',
      '## 站内知识',
      '',
    ];
    if (result.results.length === 0) {
      lines.push('未检索到站内相关知识。', '');
    } else {
      result.results.forEach((item, index) => {
        const encoded = encodeKnowledgePath(item.path);
        lines.push(
          `### ${index + 1}. ${item.title}`,
          '',
          `- 路径：${item.path}`,
          `- 章节：${item.headingPath || '（正文）'}`,
          `- 匹配：${item.matchedBy}`,
          `- 相关度：${item.score}`,
          `- 原文：GET /api/docs/detail/${encoded}.md`,
          `- 网页：/docs/detail/${encoded}`,
          '',
          item.content,
          '',
          '---',
          '',
        );
      });
    }
    lines.push(
      '> 站内结果为知识片段，需要完整上下文时继续读取“原文”；需要读取外部飞书文档时使用 `GET /api/feishu/read.md?url=`。回答时请注明来源。',
      '',
    );
    return lines.join('\n');
  }
}

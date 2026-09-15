import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, Repository } from 'typeorm';
import { DocumentSource, DocumentType } from '../common/enums';
import { ApipostService } from '../apipost/apipost.service';
import {
  swaggerToMarkdown,
  type SwaggerSpec,
} from '../apipost/apipost-markdown';
import { FeishuService } from '../feishu/feishu.service';
import { Document } from './document.entity';

/**
 * 列表查询不取 longtext 正文：列表页只需元信息，正文经 GET /documents/:id 单独加载。
 * 全量返回正文会让 /api/documents 与项目详情的关系数据背上全部 Markdown 内容。
 */
export const DOCUMENT_LIST_SELECT: FindOptionsSelect<Document> = {
  id: true,
  title: true,
  type: true,
  source: true,
  fileName: true,
  description: true,
  remark: true,
  feishuUrl: true,
  feishuToken: true,
  apipostUrl: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
};

/** 外部导入（飞书 / apipost 等）的文档正文由源同步管理，不允许本地改写 */
function isExternalSource(source: DocumentSource): boolean {
  return source !== DocumentSource.MARKDOWN;
}

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly feishu: FeishuService,
    private readonly apipost: ApipostService,
  ) {}

  /** 按项目列出文档；不传 projectId 时返回全部（全局列表页用）。不含正文 */
  findByProject(projectId?: number): Promise<Document[]> {
    return this.documents.find({
      where: projectId === undefined ? {} : { projectId },
      order: { updatedAt: 'DESC' },
      select: DOCUMENT_LIST_SELECT,
    });
  }

  async findOne(id: number): Promise<Document> {
    const doc = await this.documents.findOne({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  /** Markdown 视图（GET /documents/:id.md）：标题 + 元信息 + 正文 */
  async findOneMarkdown(id: number): Promise<string> {
    const doc = await this.findOne(id);
    const meta = [`- 类型：${doc.type}`, `- 来源：${doc.source}`];
    if (doc.description) meta.push(`- 描述：${doc.description}`);
    if (doc.remark) meta.push(`- 备注：${doc.remark}`);
    if (doc.feishuUrl) meta.push(`- 原始链接：${doc.feishuUrl}`);
    if (doc.apipostUrl) meta.push(`- 原始链接：${doc.apipostUrl}`);
    meta.push(`- 更新时间：${doc.updatedAt.toISOString()}`);
    return [
      `# ${doc.title}`,
      '',
      ...meta,
      '',
      '---',
      '',
      this.markdownBody(doc),
      '',
    ].join('\n');
  }

  /** 正文：apipost 来源为原始 JSON，实时转换为 Markdown 便于阅读；其余原样输出 */
  private markdownBody(doc: Document): string {
    if (!doc.content) return '（无正文）';
    if (doc.source !== DocumentSource.APIPOST) return doc.content;
    try {
      return swaggerToMarkdown(JSON.parse(doc.content) as SwaggerSpec);
    } catch {
      return `\`\`\`json\n${doc.content}\n\`\`\``;
    }
  }

  /** 平台内直接编写（无外部来源，source 记为 '-'） */
  createMarkdown(input: {
    projectId: number;
    title: string;
    type: DocumentType;
    content?: string;
  }): Promise<Document> {
    return this.documents.save(
      this.documents.create({ ...input, source: DocumentSource.MARKDOWN }),
    );
  }

  /**
   * 飞书单向同步：拉取内容转 Markdown 落库。
   * 同一 project 下相同 feishuKey（含 sheet/table 子标识）的文档覆盖更新——即"更新同步"。
   */
  async syncFromFeishu(input: {
    projectId: number;
    type: DocumentType;
    url: string;
    description?: string;
  }): Promise<Document> {
    const result = await this.feishu.readByUrl(input.url);
    const existing = await this.documents.findOne({
      where: { projectId: input.projectId, feishuToken: result.feishuKey },
    });
    const entity = existing ?? this.documents.create();
    entity.projectId = input.projectId;
    entity.title = result.title;
    entity.type = input.type;
    entity.source = DocumentSource.FEISHU;
    entity.content = result.content;
    entity.feishuUrl = input.url;
    entity.feishuToken = result.feishuKey;
    // 描述由用户填写：提供了才更新，避免"更新同步"清空已有描述
    if (input.description !== undefined) {
      entity.description = input.description || null;
    }
    return this.documents.save(entity);
  }

  /**
   * APIPOST 接口文档同步：拉取 swagger JSON 原样落库（content 存 JSON，单一数据源）。
   * 同一 project 下相同规范化原文链接（docs.apipost.net/docs/detail/{projectId}）的文档覆盖更新。
   * type 新建时不填默认"接口"。
   */
  async syncFromApipost(input: {
    projectId: number;
    url: string;
    type?: DocumentType;
    description?: string;
  }): Promise<Document> {
    const result = await this.apipost.readByUrl(input.url);
    const existing = await this.documents.findOne({
      where: { projectId: input.projectId, apipostUrl: result.docsUrl },
    });
    const entity = existing ?? this.documents.create();
    entity.projectId = input.projectId;
    entity.title = result.title;
    entity.type = input.type ?? DocumentType.API;
    entity.source = DocumentSource.APIPOST;
    entity.content = result.rawJson;
    entity.apipostUrl = result.docsUrl;
    if (input.description !== undefined) {
      entity.description = input.description || null;
    }
    return this.documents.save(entity);
  }

  /**
   * AI 文档 upsert（POST /api/documents/upsert.md）：按 (projectId, fileName) 判重。
   * 已存在 → 更新正文（title/type/description 提供了才更新）；不存在 → 新建（source 为 '-'）。
   * 命中外部导入（飞书/apipost）的文档时拒绝写入（只允许源同步更新）。
   */
  async upsert(input: {
    projectId: number;
    fileName: string;
    title?: string;
    type?: DocumentType;
    content: string;
    description?: string;
  }): Promise<{ doc: Document; created: boolean }> {
    const fileName = input.fileName?.trim();
    if (!fileName) throw new BadRequestException('fileName 不能为空');
    if (
      input.type !== undefined &&
      !Object.values(DocumentType).includes(input.type)
    ) {
      throw new BadRequestException(
        `非法文档类型：${input.type}（可选：${Object.values(DocumentType).join('/')}）`,
      );
    }
    const existing = await this.documents.findOne({
      where: { projectId: input.projectId, fileName },
    });
    if (existing) {
      if (isExternalSource(existing.source)) {
        throw new ForbiddenException(
          '外部导入的文档不允许本地修改，请使用更新同步',
        );
      }
      if (input.title !== undefined) existing.title = input.title;
      if (input.type !== undefined) existing.type = input.type;
      if (input.description !== undefined) {
        existing.description = input.description || null;
      }
      existing.content = input.content;
      return { doc: await this.documents.save(existing), created: false };
    }
    const doc = await this.documents.save(
      this.documents.create({
        projectId: input.projectId,
        fileName,
        title: input.title?.trim() || fileName,
        type: input.type ?? DocumentType.TECH,
        source: DocumentSource.MARKDOWN,
        content: input.content,
        description: input.description || null,
      }),
    );
    return { doc, created: true };
  }

  /** 本地修改正文：仅允许 Markdown 编写的文档；外部导入（飞书/apipost）的文档只允许源同步更新 */
  async updateContent(id: number, content: string): Promise<Document> {
    const doc = await this.findOne(id);
    if (isExternalSource(doc.source)) {
      throw new ForbiddenException(
        '外部导入的文档不允许本地修改，请使用更新同步',
      );
    }
    doc.content = content;
    return this.documents.save(doc);
  }

  /** 备注（为后续 AI 阅读准备），任何来源都可编辑 */
  async updateRemark(id: number, remark: string): Promise<Document> {
    const doc = await this.findOne(id);
    doc.remark = remark;
    return this.documents.save(doc);
  }

  async remove(id: number): Promise<void> {
    const doc = await this.findOne(id);
    await this.documents.remove(doc);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.documents.delete({ projectId });
  }
}

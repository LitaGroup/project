import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, Repository } from 'typeorm';
import { DocumentSource, DocumentType } from '../common/enums';
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
  description: true,
  remark: true,
  feishuUrl: true,
  feishuToken: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class DocumentsService {
  constructor(
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly feishu: FeishuService,
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
    meta.push(`- 更新时间：${doc.updatedAt.toISOString()}`);
    return [
      `# ${doc.title}`,
      '',
      ...meta,
      '',
      '---',
      '',
      doc.content ?? '（无正文）',
      '',
    ].join('\n');
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

  /** 本地修改正文：仅允许 Markdown 编写的文档；飞书导入的文档只允许源同步更新 */
  async updateContent(id: number, content: string): Promise<Document> {
    const doc = await this.findOne(id);
    if (doc.source === DocumentSource.FEISHU) {
      throw new ForbiddenException(
        '飞书导入的文档不允许本地修改，请使用更新同步',
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

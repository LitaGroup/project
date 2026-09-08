import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Not, Repository } from 'typeorm';
import {
  DocumentType,
  I18nSheet,
  ResourceType,
  ResourceStatus,
} from '../common/enums';
import { Document } from '../documents/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { Resource } from './resource.entity';
import { WordSheetService } from './word-sheet.service';

/**
 * 列表查询不取 longtext 缓存正文（多语言 content）：列表页只需元信息，
 * 正文经 GET /resources/:id 或 .md 单独加载。
 */
export const RESOURCE_LIST_SELECT = {
  id: true,
  type: true,
  title: true,
  status: true,
  description: true,
  url: true,
  documentId: true,
  prefix: true,
  remark: true,
  projectId: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** 飞书链接形态（与 FeishuService.parseUrl 的 host+路径判断一致，仅用于区分是否走飞书同步） */
const FEISHU_URL_PATTERN =
  /(?:feishu\.cn|larksuite\.com)\/(docx|docs|sheets|base|wiki)\/[A-Za-z0-9]+/;

/** 临时禁用的资源类型（暂不开放创建；恢复时清空此列表即可，存量数据与编辑/同步/删除不受影响） */
const DISABLED_CREATE_TYPES: ResourceType[] = [
  ResourceType.FILE,
  ResourceType.OTHER,
];

export interface CreateResourceInput {
  projectId: number;
  type: ResourceType;
  /** 标题：仅文件资源/UI/多语言（有前缀时）可留空（URL/前缀推导），其余必填；不与绑定文档标题联动 */
  title?: string;
  /** 初始状态：缺失/草稿/确认/废弃，缺省为"缺失" */
  status?: string;
  url?: string;
  description?: string;
  /** 多语言：命名空间前缀 {SHEET}$NAMESPACE（SHEET 省略默认 Activity；仅 $NAMESPACE 亦视为 Activity 下），空=缺失 */
  prefix?: string;
  remark?: string;
}

export interface UpdateResourceInput {
  title?: string;
  status?: string;
  url?: string;
  description?: string;
  /** 多语言：命名空间前缀（规范化存储），空串清除 */
  prefix?: string;
  remark?: string;
}

/**
 * 资源：项目完成需要需求方提供的素材/信息，五种类型单表存储（type 区分）。
 * 配置类型与文档模块联动——按 URL 自动绑定项目内同 URL 的配置文档，否则新建
 * （飞书链接走同步导入，其它链接建空 Markdown 文档）；多语言类型按命名空间前缀
 * （{SHEET}$NAMESPACE）记录，文案经 Lita word/sheet 接口同步缓存到 content。
 * "废弃"为软删除状态（列表默认隐藏），DELETE 接口为硬删除。
 */
@Injectable()
export class ResourcesService {
  constructor(
    @InjectRepository(Resource)
    private readonly resources: Repository<Resource>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly documentsService: DocumentsService,
    private readonly wordSheet: WordSheetService,
  ) {}

  /** 按项目列出资源；不传 projectId 返回全部（全局列表页用）。默认隐藏软删除 */
  findByProject(
    projectId?: number,
    includeDeleted = false,
  ): Promise<Resource[]> {
    const where: FindOptionsWhere<Resource> =
      projectId === undefined ? {} : { projectId };
    if (!includeDeleted) {
      where.status = Not(ResourceStatus.DISCARDED);
    }
    return this.resources.find({
      where,
      order: { updatedAt: 'DESC' },
      select: RESOURCE_LIST_SELECT,
    });
  }

  async findOne(id: number): Promise<Resource> {
    const resource = await this.resources.findOne({ where: { id } });
    if (!resource) throw new NotFoundException(`Resource ${id} not found`);
    return resource;
  }

  /** Markdown 视图（GET /resources/:id.md）：元信息 + 类型对应正文（配置取绑定文档，多语言取缓存） */
  async findOneMarkdown(id: number): Promise<string> {
    const resource = await this.findOne(id);
    const meta = [`- 类型：${resource.type}`, `- 状态：${resource.status}`];
    if (resource.url) meta.push(`- 链接：${resource.url}`);
    if (resource.documentId) {
      meta.push(
        `- 绑定文档：${resource.documentId}（\`GET /api/documents/${resource.documentId}.md\`）`,
      );
    }
    if (resource.prefix) {
      meta.push(`- 前缀：${resource.prefix}`);
    }
    if (resource.description) meta.push(`- 描述：${resource.description}`);
    if (resource.remark) meta.push(`- 备注：${resource.remark}`);
    meta.push(`- 更新时间：${resource.updatedAt.toISOString()}`);

    let body = '';
    if (resource.type === ResourceType.CONFIG && resource.documentId) {
      const doc = await this.documents.findOne({
        where: { id: resource.documentId },
      });
      body = doc ? (doc.content ?? '（文档暂无正文）') : '（绑定的文档已删除）';
    } else if (resource.type === ResourceType.I18N) {
      body =
        resource.content ??
        '（多语言文案尚未同步' +
          (resource.prefix ? '' : '：未填写前缀，状态只能为「缺失」') +
          '，同步接口 `POST /api/resources/' +
          id +
          '/sync`）';
    } else {
      body = resource.description ?? '（暂无内容）';
    }

    return [`# ${resource.title}`, '', ...meta, '', '---', '', body, ''].join(
      '\n',
    );
  }

  /**
   * 创建资源。配置类型的 URL 可空（状态"缺失"表示尚未拿到 URL）；有 URL 时走文档自动绑定：
   * 同项目下已有相同 URL 且类型为"配置"的文档则绑定，否则新建
   * （飞书链接 → 同步导入；其它链接 → 建空 Markdown 文档）。
   * 无 URL 时状态只能为"缺失"（"废弃"不受限）。
   */
  async create(input: CreateResourceInput): Promise<Resource> {
    const type = this.assertType(input.type);
    if (DISABLED_CREATE_TYPES.includes(type)) {
      throw new BadRequestException(`${type}类型暂未开放创建`);
    }
    let title = this.normalizeShort(input.title, 200, '标题');
    const url = this.normalizeUrl(input.url);
    const description = this.normalizeText(input.description);
    const remark = this.normalizeText(input.remark);
    const prefix =
      type === ResourceType.I18N ? this.normalizePrefix(input.prefix) : null;
    let documentId: number | null = null;

    switch (type) {
      case ResourceType.CONFIG: {
        // URL 可空：状态为"缺失"时需求方可能尚未提供，后补 URL 时再自动绑定/新建文档；
        // 标题始终由用户定义，不取绑定文档的标题
        if (url) {
          const doc = await this.bindConfigDocument(
            input.projectId,
            url,
            title,
          );
          documentId = doc.id;
        }
        break;
      }
      case ResourceType.I18N: {
        // 前缀可空：空=需求方尚未提供（状态只能"缺失"）；有前缀时标题可留空，取前缀
        title ??= prefix;
        break;
      }
      case ResourceType.FILE:
      case ResourceType.UI: {
        if (!url) {
          throw new BadRequestException(
            `${type}类型须提供${type === ResourceType.UI ? '蓝湖' : '文件'} URL`,
          );
        }
        title ??= url;
        break;
      }
      case ResourceType.OTHER:
        break;
    }
    if (!title) {
      throw new BadRequestException(`${type}类型须提供标题`);
    }
    const status = input.status?.trim()
      ? this.assertStatus(input.status.trim())
      : undefined;
    this.assertCredentialForStatus(
      type,
      prefix ?? url,
      status ?? ResourceStatus.MISSING,
    );
    return this.resources.save(
      this.resources.create({
        projectId: input.projectId,
        type,
        title: title.slice(0, 200),
        url,
        description,
        documentId,
        prefix,
        remark,
        ...(status !== undefined ? { status } : {}),
      }),
    );
  }

  /** 更新资源（标题/状态/链接/描述/工作表/备注）；状态校验枚举值且无 URL 时只能为"缺失"（"废弃"不受限），"废弃"即软删除 */
  async update(id: number, input: UpdateResourceInput): Promise<Resource> {
    const resource = await this.findOne(id);
    if (input.status !== undefined) {
      resource.status = this.assertStatus(input.status);
    }
    if (input.title !== undefined) {
      const title = this.normalizeShort(input.title, 200, '标题');
      if (!title) throw new BadRequestException('标题不能为空');
      resource.title = title;
    }
    if (input.description !== undefined) {
      resource.description = this.normalizeText(input.description);
    }
    if (input.remark !== undefined) {
      resource.remark = this.normalizeText(input.remark);
    }
    if (input.prefix !== undefined) {
      resource.prefix =
        resource.type === ResourceType.I18N
          ? this.normalizePrefix(input.prefix)
          : null;
    }
    if (input.url !== undefined) {
      const url = this.normalizeUrl(input.url);
      if (resource.type === ResourceType.CONFIG && url !== resource.url) {
        if (url) {
          const doc = await this.bindConfigDocument(
            resource.projectId,
            url,
            resource.title,
          );
          resource.documentId = doc.id;
        } else {
          // 清空 URL（如状态回到"缺失"）：解除文档绑定
          resource.documentId = null;
        }
      }
      resource.url = url;
    }
    this.assertCredentialForStatus(
      resource.type,
      resource.prefix ?? resource.url,
      resource.status,
    );
    return this.resources.save(resource);
  }

  /** 同步：配置类型重新拉取绑定文档（仅飞书 URL）；多语言类型按前缀拉取 Lita word/sheet 接口并缓存文案 */
  async sync(id: number): Promise<Resource> {
    const resource = await this.findOne(id);
    if (resource.type === ResourceType.CONFIG) {
      if (!resource.url) {
        throw new BadRequestException('配置资源缺少文档 URL，无法同步');
      }
      if (!FEISHU_URL_PATTERN.test(resource.url)) {
        throw new BadRequestException(
          '非飞书链接的配置资源不支持同步，请直接在绑定的文档中编辑',
        );
      }
      const doc = await this.documentsService.syncFromFeishu({
        projectId: resource.projectId,
        type: DocumentType.CONFIG,
        url: resource.url,
      });
      resource.documentId = doc.id;
      return this.resources.save(resource);
    }
    if (resource.type === ResourceType.I18N) {
      if (!resource.prefix) {
        throw new BadRequestException('多语言资源缺少前缀，无法同步');
      }
      resource.content = await this.wordSheet.readSheetMarkdown(
        resource.prefix,
      );
      return this.resources.save(resource);
    }
    throw new BadRequestException(
      `仅配置/多语言类型支持同步，当前类型：${resource.type}`,
    );
  }

  /** 硬删除（软删除请走 PATCH status=废弃）；不级联删除绑定的文档 */
  async remove(id: number): Promise<void> {
    const resource = await this.findOne(id);
    await this.resources.remove(resource);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.resources.delete({ projectId });
  }

  /** 配置类型绑定文档：同项目同 URL 的配置文档 → 复用；否则飞书同步导入 / 建空 Markdown 文档 */
  private async bindConfigDocument(
    projectId: number,
    url: string,
    title: string | null,
  ): Promise<Document> {
    const existing = await this.documents.findOne({
      where: {
        projectId,
        feishuUrl: url,
        type: DocumentType.CONFIG,
      },
    });
    if (existing) return existing;
    if (FEISHU_URL_PATTERN.test(url)) {
      return this.documentsService.syncFromFeishu({
        projectId,
        type: DocumentType.CONFIG,
        url,
      });
    }
    const doc = await this.documentsService.createMarkdown({
      projectId,
      title: (title ?? url).slice(0, 200),
      type: DocumentType.CONFIG,
    });
    // 回写 URL 到 feishuUrl，保证同 URL 的后续配置资源能按链接匹配复用该文档
    doc.feishuUrl = url;
    return this.documents.save(doc);
  }

  private assertType(type: ResourceType): ResourceType {
    if (!Object.values(ResourceType).includes(type)) {
      throw new BadRequestException(`非法的资源类型：${type}`);
    }
    return type;
  }

  /** 交付凭据门控：多语言凭据=前缀，其余类型凭据=URL；无凭据时状态只能是"缺失"（"废弃"为软删除终态不受限） */
  private assertCredentialForStatus(
    type: ResourceType,
    credential: string | null,
    status: string,
  ): void {
    const allowed: string[] = [
      ResourceStatus.MISSING,
      ResourceStatus.DISCARDED,
    ];
    if (!credential && !allowed.includes(status)) {
      throw new BadRequestException(
        `未填写${type === ResourceType.I18N ? '前缀' : ' URL 链接'}时，状态只能为「缺失」（或「废弃」）`,
      );
    }
  }

  /**
   * 多语言前缀规范化：`{SHEET}$NAMESPACE`——SHEET=Activity/Frontend/FE/Backend（省略时默认 Activity，
   * 如 `$xxx` → `Activity$xxx`）；NAMESPACE 可空（如仅 `Activity`）。空串 → null。
   */
  private normalizePrefix(value: string | undefined): string | null {
    const v = value?.trim() ?? '';
    if (!v) return null;
    const dollar = v.indexOf('$');
    let sheet: string;
    let ns: string;
    if (dollar === 0) {
      sheet = I18nSheet.ACTIVITY;
      ns = v.slice(1);
    } else if (dollar > 0) {
      sheet = v.slice(0, dollar);
      ns = v.slice(dollar + 1);
    } else {
      sheet = v;
      ns = '';
    }
    if (!(Object.values(I18nSheet) as string[]).includes(sheet)) {
      throw new BadRequestException(
        `非法的多语言前缀：${v}（SHEET 须为 ${Object.values(I18nSheet).join('/')} 之一，NAMESPACE 以 $ 开头且可省略）`,
      );
    }
    if (ns.includes('$')) {
      throw new BadRequestException(
        `非法的多语言前缀：${v}（NAMESPACE 不能再含 $）`,
      );
    }
    const normalized = ns ? `${sheet}$${ns}` : sheet;
    if (normalized.length > 300) {
      throw new BadRequestException('前缀长度不能超过 300 个字符');
    }
    return normalized;
  }

  private assertStatus(status: string): ResourceStatus {
    if (!(Object.values(ResourceStatus) as string[]).includes(status)) {
      throw new BadRequestException(`非法的资源状态：${status}`);
    }
    return status as ResourceStatus;
  }

  /** 短文本：trim，空串 → null，超长拒绝 */
  private normalizeShort(
    value: string | undefined,
    max: number,
    label: string,
  ): string | null {
    const normalized = value?.trim() ?? '';
    if (!normalized) return null;
    if (normalized.length > max) {
      throw new BadRequestException(`${label}长度不能超过 ${max} 个字符`);
    }
    return normalized;
  }

  /** 长文本：trim，空串 → null */
  private normalizeText(value: string | undefined): string | null {
    const normalized = value?.trim() ?? '';
    return normalized || null;
  }

  /** 链接：trim，空串 → null；非空须为 http(s) URL 且 ≤500 字符 */
  private normalizeUrl(value: string | undefined): string | null {
    const normalized = value?.trim() ?? '';
    if (!normalized) return null;
    if (!/^https?:\/\//i.test(normalized)) {
      throw new BadRequestException('链接须以 http:// 或 https:// 开头');
    }
    if (normalized.length > 500) {
      throw new BadRequestException('链接长度不能超过 500 个字符');
    }
    return normalized;
  }
}

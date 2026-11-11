import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsSelect, FindOptionsWhere, Repository } from 'typeorm';
import { IdeaStatus, IdeaType, ProjectType } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { matchesPinyinSearch } from '../common/pinyin-search';
import { ProjectsService } from '../projects/projects.service';
import { Idea } from './idea.entity';

/** 图片上限（单条灵感最多 9 张，经 POST /api/images 上传） */
const MAX_IMAGES = 9;

/** 列表查询上限（灵感为轻量记录，全量倒序拉取后前端展示） */
const LIST_LIMIT = 1000;

export const IDEA_LIST_SELECT: FindOptionsSelect<Idea> = {
  id: true,
  title: true,
  type: true,
  status: true,
  images: true,
  creatorId: true,
  creatorName: true,
  projectId: true,
  adoptedAt: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * 操作人身份：网页操作为真人；MCP 机器人创建/完善时优先落到绑定真人，
 * 未绑定真人时 `userId` 为空、`userName` 为机器人名称。
 */
export interface IdeaActor {
  userId: number | null;
  userName: string;
  isAdmin: boolean;
}

export interface CreateIdeaInput {
  title: string;
  /** 正文（Markdown，可空） */
  content?: string;
  /** 构思/创意/待办/建议/其它（默认想法） */
  type?: IdeaType;
  /** 图片：/images/... 路径数组，最多 9 张 */
  images?: string[];
}

export interface UpdateIdeaInput {
  title?: string;
  content?: string;
  images?: string[];
  type?: IdeaType;
}

export interface ChangeIdeaStatusInput {
  /** 目标状态：构思/废弃/采纳 */
  status: IdeaStatus;
  /** 采纳时在需求池新建需求（标题/正文取自灵感） */
  createProject?: boolean;
  /** 采纳时关联已有需求（projects.id） */
  projectId?: number | null;
  /** 新建需求的项目类型（默认其它） */
  projectType?: ProjectType;
}

export interface IdeaListQuery {
  q?: string;
  status?: IdeaStatus;
  type?: IdeaType;
}

/** Markdown 表格单元格转义（换行与竖线） */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

@Injectable()
export class IdeasService {
  constructor(
    @InjectRepository(Idea)
    private readonly ideas: Repository<Idea>,
    private readonly projects: ProjectsService,
  ) {}

  /**
   * 灵感列表（不含 content 大正文）：状态/类型走 SQL 过滤，
   * 关键词复用拼音匹配（标题 + 创建人，支持原文/全拼/首字母）。
   */
  async list(query: IdeaListQuery): Promise<Idea[]> {
    const where: FindOptionsWhere<Idea> = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    const rows = await this.ideas.find({
      where,
      select: IDEA_LIST_SELECT,
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
    if (!query.q) return rows;
    return rows.filter((idea) =>
      matchesPinyinSearch(query.q as string, [idea.title, idea.creatorName]),
    );
  }

  async findOne(id: number): Promise<Idea> {
    const idea = await this.ideas.findOne({ where: { id } });
    if (!idea) throw new NotFoundException(`Idea ${id} not found`);
    return idea;
  }

  async create(input: CreateIdeaInput, actor: IdeaActor): Promise<Idea> {
    const idea = this.ideas.create({
      title: this.normalizeTitle(input.title),
      content: (input.content ?? '').trim(),
      type: this.normalizeType(input.type),
      status: IdeaStatus.DRAFT,
      images: this.normalizeImages(input.images),
      creatorId: actor.userId,
      creatorName: actor.userName,
      projectId: null,
      adoptedAt: null,
    });
    return this.ideas.save(idea);
  }

  /**
   * 更新灵感：构思期任何登录用户可编辑（协作完善）；
   * 采纳/废弃后仅管理员可修改。
   */
  async update(
    id: number,
    input: UpdateIdeaInput,
    actor: IdeaActor,
  ): Promise<Idea> {
    const idea = await this.findOne(id);
    this.assertEditable(idea, actor);

    if (input.title !== undefined)
      idea.title = this.normalizeTitle(input.title);
    if (input.content !== undefined) idea.content = input.content.trim();
    if (input.images !== undefined) {
      idea.images = this.normalizeImages(input.images);
    }
    if (input.type !== undefined) idea.type = this.normalizeType(input.type);
    return this.ideas.save(idea);
  }

  /**
   * 状态流转（仅管理员）：
   * - 采纳：在需求池新建需求或关联已有需求，回写 projectId 并记录 adoptedAt；
   * - 构思/废弃：清空 adoptedAt，保留 projectId 作历史关联（再次采纳可重选）。
   */
  async changeStatus(
    id: number,
    input: ChangeIdeaStatusInput,
    actor: IdeaActor,
  ): Promise<Idea> {
    this.assertAdmin(actor, '仅管理员可流转灵感状态');
    const idea = await this.findOne(id);
    const status = Object.values(IdeaStatus).includes(input.status)
      ? input.status
      : undefined;
    if (!status)
      throw new BadRequestException('灵感状态仅允许：构思/废弃/采纳');

    if (status === IdeaStatus.ADOPTED) {
      const project = await this.resolveAdoptionProject(idea, input);
      idea.projectId = project.id;
      if (!idea.adoptedAt) idea.adoptedAt = new Date();
    } else {
      idea.adoptedAt = null;
    }
    idea.status = status;
    return this.ideas.save(idea);
  }

  /** 删除：管理员可删任意；创建人仅能撤销「构思」中的灵感 */
  async remove(id: number, actor: IdeaActor): Promise<void> {
    const idea = await this.findOne(id);
    const isOwn = idea.creatorId !== null && idea.creatorId === actor.userId;
    if (!actor.isAdmin && !(isOwn && idea.status === IdeaStatus.DRAFT)) {
      throw new ForbiddenException('仅管理员或创建人（构思中）可删除灵感');
    }
    await this.ideas.remove(idea);
  }

  /** GET /api/ideas.md：灵感清单 Markdown 视图 */
  async listMarkdown(query: IdeaListQuery): Promise<string> {
    const rows = await this.list(query);
    const head = mdFrontmatter({
      title: '灵感列表',
      description: `共 ${rows.length} 条`,
    });
    const lines: string[] = [
      '# 灵感',
      '',
      `共 ${rows.length} 条。详情：GET /api/ideas/{id}.md；采纳会进入需求池（GET /api/projects/{id}.md）。`,
      '',
    ];
    if (rows.length === 0) {
      lines.push('（暂无灵感）');
    } else {
      lines.push(
        '| ID | 标题 | 类型 | 状态 | 创建人 | 创建时间 | 需求 | 详情 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const idea of rows) {
        lines.push(
          `| ${idea.id} | ${escapeCell(idea.title)} | ${idea.type} | ${idea.status} | ${escapeCell(
            idea.creatorName ?? '-',
          )} | ${beijingTime(idea.createdAt)} | ${
            idea.projectId ? `#${idea.projectId}` : '-'
          } | /api/ideas/${idea.id}.md |`,
        );
      }
    }
    return `${head}${lines.join('\n')}\n`;
  }

  /** GET /api/ideas/:id.md：灵感详情 Markdown 视图（正文 + 图片 + 采纳信息） */
  async findOneMarkdown(id: number): Promise<string> {
    const idea = await this.findOne(id);
    const head = mdFrontmatter({
      update: idea.updatedAt,
      title: idea.title,
      type: idea.type,
      status: idea.status,
      creator: idea.creatorName ?? undefined,
    });
    const meta = [
      `- 灵感 ID：${idea.id}`,
      `- 类型：${idea.type}`,
      `- 状态：${idea.status}`,
      `- 创建人：${idea.creatorName ?? '-'}（创建 ${beijingTime(idea.createdAt)}）`,
    ];
    if (idea.adoptedAt) meta.push(`- 采纳时间：${beijingTime(idea.adoptedAt)}`);
    if (idea.projectId)
      meta.push(`- 需求：\`GET /api/projects/${idea.projectId}.md\``);
    if (idea.images?.length) meta.push(`- 图片：${idea.images.join('、')}`);
    const sections = ['# 灵感', '', ...meta, ''];
    sections.push('## 正文', '', idea.content.trim() || '（暂无正文）');
    return `${head}${sections.join('\n')}\n`;
  }

  /** 采纳联动需求池：新建需求 / 关联已有需求 / 复用历史关联 */
  private async resolveAdoptionProject(
    idea: Idea,
    input: ChangeIdeaStatusInput,
  ): Promise<{ id: number }> {
    if (input.createProject) {
      return this.projects.create({
        name: idea.title,
        type: this.normalizeProjectType(input.projectType),
        description: idea.content.trim() || undefined,
      });
    }
    if (input.projectId !== undefined && input.projectId !== null) {
      if (!Number.isInteger(input.projectId) || input.projectId <= 0) {
        throw new BadRequestException('关联需求 ID 非法');
      }
      return this.projects.findOne(input.projectId);
    }
    // 退回构思后再次采纳：projectId 保留为历史关联，可直接复用
    if (idea.projectId) return this.projects.findOne(idea.projectId);
    throw new BadRequestException('采纳灵感时需新建需求或关联已有需求');
  }

  private assertEditable(idea: Idea, actor: IdeaActor): void {
    if (actor.isAdmin) return;
    if (idea.status !== IdeaStatus.DRAFT) {
      throw new ForbiddenException('灵感采纳或废弃后仅管理员可修改内容');
    }
  }

  private assertAdmin(actor: IdeaActor, message: string): void {
    if (!actor.isAdmin) throw new ForbiddenException(message);
  }

  private normalizeTitle(title: string): string {
    const trimmed = (title ?? '').trim();
    if (!trimmed) throw new BadRequestException('标题不能为空');
    if (trimmed.length > 200) throw new BadRequestException('标题最长 200 字');
    return trimmed;
  }

  private normalizeType(type?: IdeaType): IdeaType {
    if (type === undefined) return IdeaType.IDEA;
    if (!Object.values(IdeaType).includes(type)) {
      throw new BadRequestException('灵感类型仅允许：想法/创意/待办/建议/其它');
    }
    return type;
  }

  private normalizeProjectType(type?: ProjectType): ProjectType {
    if (type === undefined) return ProjectType.OTHER;
    if (!Object.values(ProjectType).includes(type)) {
      throw new BadRequestException(
        '需求类型仅允许：活动/功能/游戏/数据/后台/技术/其它',
      );
    }
    return type;
  }

  private normalizeImages(images?: string[]): string[] | null {
    if (images === undefined) return null;
    if (!Array.isArray(images))
      throw new BadRequestException('images 必须为数组');
    if (images.length > MAX_IMAGES) {
      throw new BadRequestException(`图片最多 ${MAX_IMAGES} 张`);
    }
    for (const url of images) {
      if (typeof url !== 'string' || !url.startsWith('/images/')) {
        throw new BadRequestException(
          '图片仅接受 /api/images 上传返回的 /images/... 地址',
        );
      }
    }
    return images.length ? images : null;
  }
}

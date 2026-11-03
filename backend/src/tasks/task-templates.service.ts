import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { mdFrontmatter } from '../common/frontmatter';
import { markdownCell, markdownLabel } from '../common/markdown-table';
import { TASK_TYPE_DEFAULT } from '../task-types/task-type.entity';
import { TaskTypesService } from '../task-types/task-types.service';
import { Worker } from '../workers/worker.entity';
import { TaskTemplateFollow } from './task-template-follow.entity';
import { TaskTemplate } from './task-template.entity';
import {
  ensureTaskTemplateSequenceFloor,
  isSystemTaskTemplateId,
  SYSTEM_TICKET_TASK_TEMPLATES,
  SYSTEM_UNKNOWN_TASK_TEMPLATE_DESCRIPTION,
  SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
  SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME,
  TICKET_TASK_TYPE,
} from './system-task-templates';

export interface CreateTaskTemplateInput {
  name: string;
  /** 任务类型名称（task_types.name，缺省「其它」） */
  type?: string | null;
  /** Markdown 描述：包含任务范围、所需输入与交付方式 */
  description?: string | null;
  /** 默认处理机器人 workers.id 列表（可多选，空数组=不指定） */
  agentIds?: number[] | null;
}

export type UpdateTaskTemplateInput = Partial<CreateTaskTemplateInput>;

/** 创建人信息（用户/公共 Agent 记录用户 ID；机器人 Token 仅记录机器人名称） */
export interface TaskTemplateActor {
  id: number | null;
  name: string;
}

/** 任务定义列表项：附带当前用户是否已关注 */
export type TaskTemplateWithFollow = TaskTemplate & { followedByMe: boolean };

/** 任务定义管理（TaskTemplate）：一类任务的可复用类型、描述与默认处理机器人 */
@Injectable()
export class TaskTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TaskTemplatesService.name);

  constructor(
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(TaskTemplateFollow)
    private readonly follows: Repository<TaskTemplateFollow>,
    private readonly taskTypes: TaskTypesService,
  ) {}

  /** 系统任务定义使用 id < 1000；网页新建的自定义定义从 1000 开始 */
  async onModuleInit(): Promise<void> {
    await this.ensureUnknownTemplate();
    await this.ensureTicketTemplates();
    await ensureTaskTemplateSequenceFloor(this.templates);
  }

  /**
   * 保证六类工单调度定义存在（固定 ID 10-15）。
   * ID 已被其他定义占用时直接报错，避免静默覆盖生产数据。
   */
  private async ensureTicketTemplates(): Promise<void> {
    for (const definition of SYSTEM_TICKET_TASK_TEMPLATES) {
      const existing = await this.templates.findOne({
        where: { id: definition.id },
      });
      if (existing) {
        if (
          existing.name !== definition.name ||
          existing.type !== TICKET_TASK_TYPE
        ) {
          throw new Error(
            `系统工单任务定义 ID=${definition.id} 已被「${existing.name}」占用，` +
              `期望名称为「${definition.name}」且类型为「${TICKET_TASK_TYPE}」，请先清理冲突数据`,
          );
        }
        continue;
      }
      await this.templates.query(
        `INSERT INTO task_templates ("id", "name", "type", "description", "agentIds")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("id") DO NOTHING`,
        [
          definition.id,
          definition.name,
          TICKET_TASK_TYPE,
          definition.description,
          '[]',
        ],
      );
      const created = await this.templates.findOne({
        where: { id: definition.id },
      });
      if (!created) {
        throw new Error(
          `系统工单任务定义「${definition.name}」#${definition.id} 创建失败`,
        );
      }
      this.logger.log(
        `已内置系统工单任务定义「${definition.name}」#${definition.id}（请配置处理机器人）`,
      );
    }
  }

  /** 保证系统未知任务定义（固定 ID=6）存在，供无法匹配的任务兜底 */
  private async ensureUnknownTemplate(): Promise<void> {
    const existing = await this.templates.findOne({
      where: { id: SYSTEM_UNKNOWN_TASK_TEMPLATE_ID },
    });
    if (existing) {
      if (existing.name !== SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME) {
        this.logger.warn(
          `任务定义 ID=${SYSTEM_UNKNOWN_TASK_TEMPLATE_ID} 已存在但名称为「${existing.name}」，按系统未知任务定义使用`,
        );
      }
      return;
    }
    await this.templates.query(
      `INSERT INTO task_templates ("id", "name", "type", "description", "agentIds")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [
        SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
        SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME,
        TASK_TYPE_DEFAULT,
        SYSTEM_UNKNOWN_TASK_TEMPLATE_DESCRIPTION,
        '[]',
      ],
    );
    const created = await this.templates.findOne({
      where: { id: SYSTEM_UNKNOWN_TASK_TEMPLATE_ID },
    });
    if (!created) {
      this.logger.warn(
        `系统未知任务定义「${SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME}」#${SYSTEM_UNKNOWN_TASK_TEMPLATE_ID} 未能创建（名称可能已被其他任务定义占用）`,
      );
      return;
    }
    this.logger.log(
      `已内置系统未知任务定义「${SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME}」#${SYSTEM_UNKNOWN_TASK_TEMPLATE_ID}（请配置处理机器人）`,
    );
  }

  /** 任务定义列表（附 followedByMe，供个人中心「我的任务定义」使用） */
  async findAll(userId?: number | null): Promise<TaskTemplateWithFollow[]> {
    const templates = await this.templates.find({
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    if (!userId) return templates.map((t) => ({ ...t, followedByMe: false }));
    const follows = await this.follows.find({ where: { userId } });
    const followedIds = new Set(follows.map((follow) => follow.templateId));
    return templates.map((template) => ({
      ...template,
      followedByMe: followedIds.has(template.id),
    }));
  }

  /** 关注任务定义（重复关注幂等） */
  async follow(id: number, userId: number): Promise<TaskTemplateWithFollow> {
    const template = await this.findOne(id);
    await this.follows
      .createQueryBuilder()
      .insert()
      .values({ templateId: id, userId })
      .orIgnore()
      .execute();
    return { ...template, followedByMe: true };
  }

  /** 取消关注任务定义（未关注时幂等） */
  async unfollow(id: number, userId: number): Promise<TaskTemplateWithFollow> {
    const template = await this.findOne(id);
    await this.follows.delete({ templateId: id, userId });
    return { ...template, followedByMe: false };
  }

  async findOne(id: number): Promise<TaskTemplate> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`TaskTemplate ${id} not found`);
    }
    return template;
  }

  /** Agent 清单：GET /api/task-templates.md */
  async listMarkdown(): Promise<string> {
    const templates = await this.findAll();
    const agentNames = await this.agentNames(
      templates.flatMap((template) => template.agentIds ?? []),
    );
    const lines = [
      mdFrontmatter({ title: '任务定义' }),
      '# 任务定义',
      '',
      `共 ${templates.length} 个任务定义。`,
      '',
      '| ID | 名称 | 任务类型 | 处理机器人 | 来源 | 创建人 | 更新时间 |',
      '| --- | --- | --- | --- | --- | --- | --- |',
    ];
    for (const template of templates) {
      lines.push(
        `| [${template.id}](/api/task-templates/${template.id}.md) | ${markdownCell(template.name)} | ${markdownCell(template.type)} | ${markdownCell(this.agentLabel(template.agentIds, agentNames))} | ${isSystemTaskTemplateId(template.id) ? '系统' : '自定义'} | ${markdownCell(template.createdByName ?? '-')} | ${template.updatedAt.toISOString()} |`,
      );
    }
    if (templates.length === 0) {
      lines.push('| - | （暂无任务定义） | - | - | - | - | - |');
    }
    lines.push(
      '',
      '系统任务定义（ID 6、10-15）不可改名、不可修改类型、不可删除；描述和处理机器人仍可维护。',
      '',
      '## AI 操作',
      '',
      '```bash',
      'curl -X POST /api/task-templates/create.md -H \'Content-Type: application/json\' -d \'{"name":"活动前端开发","type":"前端开发","description":"任务定义描述","agentIds":[1001]}\'  # 创建',
      'curl -X POST /api/task-templates/{id}/update.md -H \'Content-Type: application/json\' -d \'{"description":"新的任务定义描述","agentIds":[1001,1002]}\'  # 编辑',
      'curl -X POST /api/task-templates/{id}/delete.md  # 删除（系统定义拒绝）',
      '```',
      '',
    );
    return lines.join('\n');
  }

  /** Agent 详情：GET /api/task-templates/:id.md */
  async findOneMarkdown(id: number): Promise<string> {
    const template = await this.findOne(id);
    const agentNames = await this.agentNames(template.agentIds ?? []);
    return [
      mdFrontmatter({ update: template.updatedAt, title: template.name }),
      `# ${template.name}`,
      '',
      `- ID：${template.id}`,
      `- 任务类型：${template.type}`,
      `- 来源：${isSystemTaskTemplateId(id) ? '系统（不可改名、不可修改类型、不可删除）' : '自定义'}`,
      `- 处理机器人：${this.agentLabel(template.agentIds, agentNames)}`,
      `- 创建人：${template.createdByName ?? '—'}`,
      `- 创建时间：${template.createdAt.toISOString()}`,
      `- 更新时间：${template.updatedAt.toISOString()}`,
      '',
      '## 任务定义描述',
      '',
      template.description?.trim() || '（暂无任务定义描述）',
      '',
      '## AI 操作',
      '',
      '```bash',
      `curl -X POST /api/task-templates/${template.id}/update.md -H 'Content-Type: application/json' -d '{"description":"新的任务定义描述","agentIds":[1001]}'  # 编辑`,
      `curl -X POST /api/task-templates/${template.id}/delete.md  # 删除（系统定义拒绝）`,
      '```',
      '',
    ].join('\n');
  }

  /** Agent 创建：POST /api/task-templates/create.md */
  async createMarkdown(
    input: CreateTaskTemplateInput,
    actor?: TaskTemplateActor | null,
  ): Promise<string> {
    const template = await this.create(input, actor);
    return this.renderMutationMarkdown('创建', template);
  }

  /** Agent 编辑：POST /api/task-templates/:id/update.md */
  async updateMarkdown(
    id: number,
    input: UpdateTaskTemplateInput,
  ): Promise<string> {
    const template = await this.update(id, input);
    return this.renderMutationMarkdown('更新', template);
  }

  /** Agent 删除：POST /api/task-templates/:id/delete.md */
  async removeMarkdown(id: number): Promise<string> {
    const template = await this.findOne(id);
    await this.remove(id);
    return [
      mdFrontmatter({ title: template.name }),
      '# 任务定义已删除',
      '',
      `- ID：${template.id}`,
      `- 名称：${template.name}`,
      `- 任务类型：${template.type}`,
      '',
      '已创建的历史任务不受影响。',
      '',
    ].join('\n');
  }

  private renderMutationMarkdown(
    action: string,
    template: TaskTemplate,
  ): string {
    return [
      mdFrontmatter({ update: template.updatedAt, title: template.name }),
      `# 任务定义已${action}`,
      '',
      `- ID：${template.id}`,
      `- 名称：${template.name}`,
      `- 任务类型：${template.type}`,
      `- 来源：${isSystemTaskTemplateId(template.id) ? '系统' : '自定义'}`,
      `- 阅读地址：GET /api/task-templates/${template.id}.md`,
      '',
    ].join('\n');
  }

  private async agentNames(agentIds: number[]): Promise<Map<number, string>> {
    const ids = [...new Set(agentIds)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    if (ids.length === 0) return new Map();
    const workers = await this.workers.find({ where: { id: In(ids) } });
    return new Map(
      workers.map((worker) => [
        worker.id,
        // 存量定义若仍引用个人 AGENT，展示时统一用其主人姓名
        worker.personalAgentUserId
          ? (worker.ownerName ?? worker.name)
          : worker.name,
      ]),
    );
  }

  private agentLabel(
    agentIds: number[] | null | undefined,
    names: Map<number, string>,
  ): string {
    const ids = agentIds ?? [];
    if (ids.length === 0) return '—';
    return ids
      .map((id) => {
        const name = names.get(id);
        return name ? `${markdownLabel(name)}#${id}` : `#${id}`;
      })
      .join('、');
  }

  async create(
    input: CreateTaskTemplateInput,
    actor?: TaskTemplateActor | null,
  ): Promise<TaskTemplateWithFollow> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('模板名称不能为空');
    await this.assertNameAvailable(name, null);
    const type =
      (await this.taskTypes.assertExists(input.type)) ?? TASK_TYPE_DEFAULT;
    const agentIds = await this.normalizeAgents(input.agentIds);

    const template = await this.templates.save(
      this.templates.create({
        name,
        type,
        description: input.description?.trim() || null,
        agentIds,
        createdById: actor?.id ?? null,
        createdByName: actor?.name ?? null,
      }),
    );
    return { ...template, followedByMe: false };
  }

  async update(
    id: number,
    input: UpdateTaskTemplateInput,
  ): Promise<TaskTemplate> {
    const template = await this.findOne(id);
    const system = isSystemTaskTemplateId(id);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('模板名称不能为空');
      if (system && name !== template.name) {
        throw new BadRequestException(
          `系统任务定义「${template.name}」（ID=${id}）不允许改名`,
        );
      }
      await this.assertNameAvailable(name, id);
      template.name = name;
    }
    if (input.type !== undefined) {
      const type = await this.taskTypes.assertExists(input.type);
      if (!type) throw new BadRequestException('任务类型不能为空');
      if (system && type !== template.type) {
        throw new BadRequestException(
          `系统任务定义「${template.name}」（ID=${id}）不允许修改任务类型`,
        );
      }
      template.type = type;
    }
    if (input.description !== undefined) {
      template.description = input.description?.trim() || null;
    }
    if (input.agentIds !== undefined) {
      template.agentIds = await this.normalizeAgents(input.agentIds);
    }
    return this.templates.save(template);
  }

  async remove(id: number): Promise<void> {
    if (isSystemTaskTemplateId(id)) {
      throw new BadRequestException(
        `系统任务定义（ID=${id}）由平台保留，不能删除`,
      );
    }
    const template = await this.findOne(id);
    await this.templates.remove(template);
    await this.follows.delete({ templateId: id });
  }

  private async assertNameAvailable(
    name: string,
    excludeId: number | null,
  ): Promise<void> {
    const exists = await this.templates.findOne({ where: { name } });
    if (exists && exists.id !== excludeId) {
      throw new BadRequestException(`模板名称「${name}」已存在`);
    }
  }

  /** 处理机器人须存在、启用且为工作者（调度机器人/个人 AGENT 不承接任务），并去重 */
  private async normalizeAgents(
    agentIds: number[] | null | undefined,
  ): Promise<number[]> {
    if (!agentIds || agentIds.length === 0) return [];
    const unique = [...new Set(agentIds)];
    const kept: number[] = [];
    for (const agentId of unique) {
      if (!Number.isInteger(agentId) || agentId < 1) {
        throw new BadRequestException('处理机器人 ID 必须为正整数');
      }
      const worker = await this.workers.findOne({ where: { id: agentId } });
      if (!worker) throw new BadRequestException('处理机器人不存在');
      if (!worker.enabled) throw new BadRequestException('处理机器人已停用');
      if (worker.role === WorkerRole.SCHEDULER) {
        throw new BadRequestException('调度机器人不承接任务，请选择工作者');
      }
      // 个人 AGENT 只承载「我的 AI」对话：存量引用在保存时静默剔除，
      // 避免它出现在任务定义等对外场景。
      if (worker.personalAgentUserId) continue;
      kept.push(agentId);
    }
    return kept;
  }
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Worker } from '../workers/worker.entity';
import { Task } from '../tasks/task.entity';
import { TaskTemplate } from '../tasks/task-template.entity';
import { mdFrontmatter } from '../common/frontmatter';
import { markdownCell, markdownLabel } from '../common/markdown-table';
import {
  DEFAULT_TASK_TYPES,
  SYSTEM_TASK_TYPE_NAMES,
  TASK_TYPE_DEFAULT,
  TASK_TYPE_TICKET,
  TASK_TYPE_UNKNOWN,
  TaskType,
} from './task-type.entity';

export interface CreateTaskTypeInput {
  name: string;
  description?: string | null;
}

export type UpdateTaskTypeInput = Partial<CreateTaskTypeInput>;

/** 纯中文名称：2-8 个汉字 */
const CHINESE_NAME_PATTERN = /^[\u4e00-\u9fff]{2,8}$/;
/** 纯英文名称：1-64 个英文字符 */
const ENGLISH_NAME_PATTERN = /^[A-Za-z]{1,64}$/;

/** 校验并归一化类型名称（trim；纯中文 2-8 字，或纯英文 1-64 字符） */
export function validateTaskTypeName(value: string): string {
  const name = (value ?? '').trim();
  if (!name) throw new BadRequestException('类型名称不能为空');
  if (!CHINESE_NAME_PATTERN.test(name) && !ENGLISH_NAME_PATTERN.test(name)) {
    throw new BadRequestException(
      '类型名称须为 2-8 个中文字符，或不超过 64 个英文字符',
    );
  }
  return name;
}

/**
 * 任务类型字典管理（原固定枚举 TaskType 迁移为 task_types 表）。
 * 无物理外键：tasks.type 存类型名称字符串，改名由本服务应用层同步；
 * 删除保护与引用校验同样在应用层完成。
 */
@Injectable()
export class TaskTypesService implements OnModuleInit {
  constructor(
    @InjectRepository(TaskType)
    private readonly types: Repository<TaskType>,
    @InjectRepository(Task)
    private readonly tasks: Repository<Task>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
  ) {}

  /** 空表时补齐初始类型（开发环境 synchronize 建表但不会执行迁移种子；生产由迁移先行） */
  async onModuleInit(): Promise<void> {
    const count = await this.types.count();
    if (count === 0) {
      await this.types
        .createQueryBuilder()
        .insert()
        .into(TaskType)
        .values(DEFAULT_TASK_TYPES)
        .orIgnore()
        .execute();
    }
    // 已有数据的库补入新增系统类型（新库在上面的全量初始化中已写入）
    const systemTypes: Array<{ name: string; description: string }> = [
      {
        name: TASK_TYPE_UNKNOWN,
        description:
          '平台无法匹配任务定义/类型对应机器人时自动归入，由系统未知任务定义（ID=6）接管',
      },
      {
        name: TASK_TYPE_TICKET,
        description:
          '工单创建的调度任务类型，按工单类型绑定的系统任务定义分发，不允许改名与删除',
      },
    ];
    for (const item of systemTypes) {
      const exists = await this.types.findOne({ where: { name: item.name } });
      if (exists) continue;
      await this.types
        .createQueryBuilder()
        .insert()
        .into(TaskType)
        .values(item)
        .orIgnore()
        .execute();
    }
    // 历史枚举值归一（生产迁移已处理；开发环境无迁移时在此补齐，重复执行无副作用）
    await this.tasks.update({ type: 'UI设计' }, { type: 'UI' });
  }

  findAll(): Promise<TaskType[]> {
    return this.types.find({ order: { id: 'ASC' } });
  }

  async findOne(id: number): Promise<TaskType> {
    const type = await this.types.findOne({ where: { id } });
    if (!type) {
      throw new NotFoundException(`TaskType ${id} not found`);
    }
    return type;
  }

  /** Agent 清单：GET /api/task-types.md */
  async listMarkdown(): Promise<string> {
    const types = await this.findAll();
    const lines = [
      mdFrontmatter({ title: '任务类型' }),
      '# 任务类型',
      '',
      `共 ${types.length} 个类型。`,
      '',
      '| ID | 名称 | 来源 | 描述 | 更新时间 |',
      '| --- | --- | --- | --- | --- |',
    ];
    for (const type of types) {
      lines.push(
        `| [${type.id}](/api/task-types/${type.id}.md) | ${markdownCell(type.name)} | ${this.isSystemType(type) ? '系统' : '自定义'} | ${markdownCell(markdownLabel(type.description))} | ${type.updatedAt.toISOString()} |`,
      );
    }
    if (types.length === 0) {
      lines.push('| - | （暂无任务类型） | - | - | - |');
    }
    lines.push(
      '',
      '系统类型「其它」「未知任务」「工单」不可改名或删除，但允许修改描述。',
      '',
      '## AI 操作',
      '',
      '```bash',
      'curl -X POST /api/task-types/create.md -H \'Content-Type: application/json\' -d \'{"name":"数据分析","description":"数据查询与分析"}\'  # 创建',
      'curl -X POST /api/task-types/{id}/update.md -H \'Content-Type: application/json\' -d \'{"name":"新类型名称","description":"新的描述"}\'  # 编辑（改名会同步任务/任务定义/机器人任务定义）',
      'curl -X POST /api/task-types/{id}/delete.md  # 删除（被引用或系统类型时拒绝）',
      '```',
      '',
    );
    return lines.join('\n');
  }

  /** Agent 详情：GET /api/task-types/:id.md */
  async findOneMarkdown(id: number): Promise<string> {
    const type = await this.findOne(id);
    return [
      mdFrontmatter({ update: type.updatedAt, title: type.name }),
      `# ${type.name}`,
      '',
      `- ID：${type.id}`,
      `- 来源：${this.isSystemType(type) ? '系统（名称不可修改，不可删除）' : '自定义'}`,
      `- 创建时间：${type.createdAt.toISOString()}`,
      `- 更新时间：${type.updatedAt.toISOString()}`,
      '',
      '## 类型描述',
      '',
      type.description.trim() || '（暂无描述）',
      '',
      '## AI 操作',
      '',
      '```bash',
      `curl -X POST /api/task-types/${type.id}/update.md -H 'Content-Type: application/json' -d '{"description":"新的描述"}'  # 编辑`,
      `curl -X POST /api/task-types/${type.id}/delete.md  # 删除（系统类型或仍被引用时拒绝）`,
      '```',
      '',
    ].join('\n');
  }

  /** Agent 创建：POST /api/task-types/create.md */
  async createMarkdown(input: CreateTaskTypeInput): Promise<string> {
    const type = await this.create(input);
    return this.renderMutationMarkdown('创建', type);
  }

  /** Agent 编辑：POST /api/task-types/:id/update.md */
  async updateMarkdown(
    id: number,
    input: UpdateTaskTypeInput,
  ): Promise<string> {
    const before = await this.findOne(id);
    const type = await this.update(id, input);
    const renamed = before.name !== type.name;
    return this.renderMutationMarkdown('更新', type, { renamed });
  }

  /** Agent 删除：POST /api/task-types/:id/delete.md */
  async removeMarkdown(id: number): Promise<string> {
    const type = await this.findOne(id);
    await this.remove(id);
    return [
      mdFrontmatter({ title: type.name }),
      '# 任务类型已删除',
      '',
      `- ID：${type.id}`,
      `- 名称：${type.name}`,
      '',
    ].join('\n');
  }

  private isSystemType(type: TaskType): boolean {
    return SYSTEM_TASK_TYPE_NAMES.includes(type.name);
  }

  private renderMutationMarkdown(
    action: string,
    type: TaskType,
    options?: { renamed?: boolean },
  ): string {
    const lines = [
      mdFrontmatter({ update: type.updatedAt, title: type.name }),
      `# 任务类型已${action}`,
      '',
      `- ID：${type.id}`,
      `- 名称：${type.name}`,
      `- 来源：${this.isSystemType(type) ? '系统' : '自定义'}`,
      `- 阅读地址：GET /api/task-types/${type.id}.md`,
    ];
    if (options?.renamed) {
      lines.push(
        '- 引用同步：已同步任务、任务定义与机器人任务定义中的类型名称',
      );
    }
    lines.push('');
    return lines.join('\n');
  }

  async create(input: CreateTaskTypeInput): Promise<TaskType> {
    const name = validateTaskTypeName(input.name);
    await this.assertNameAvailable(name, null);
    return this.types.save(
      this.types.create({
        name,
        description: input.description?.trim() || '',
      }),
    );
  }

  async update(id: number, input: UpdateTaskTypeInput): Promise<TaskType> {
    const type = await this.findOne(id);
    let renamed: { from: string; to: string } | null = null;
    if (input.name !== undefined) {
      const name = validateTaskTypeName(input.name);
      if (name !== type.name) {
        if (type.name === TASK_TYPE_DEFAULT) {
          throw new BadRequestException('默认类型「其它」不允许改名');
        }
        if (type.name === TASK_TYPE_UNKNOWN) {
          throw new BadRequestException('系统类型「未知任务」不允许改名');
        }
        if (SYSTEM_TASK_TYPE_NAMES.includes(type.name)) {
          throw new BadRequestException(`系统类型「${type.name}」不允许改名`);
        }
        await this.assertNameAvailable(name, id);
        renamed = { from: type.name, to: name };
        type.name = name;
      }
    }
    if (input.description !== undefined) {
      type.description = input.description?.trim() || '';
    }
    const saved = await this.types.save(type);
    if (renamed) await this.renameReferences(renamed.from, renamed.to);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const type = await this.findOne(id);
    if (type.name === TASK_TYPE_DEFAULT) {
      throw new BadRequestException('默认类型「其它」不可删除');
    }
    if (type.name === TASK_TYPE_UNKNOWN) {
      throw new BadRequestException('系统类型「未知任务」不可删除');
    }
    if (SYSTEM_TASK_TYPE_NAMES.includes(type.name)) {
      throw new BadRequestException(`系统类型「${type.name}」不可删除`);
    }
    const taskCount = await this.tasks.count({ where: { type: type.name } });
    if (taskCount > 0) {
      throw new BadRequestException(
        `类型「${type.name}」已被 ${taskCount} 个任务使用，不能删除`,
      );
    }
    const templateCount = await this.taskTemplates.count({
      where: { type: type.name },
    });
    if (templateCount > 0) {
      throw new BadRequestException(
        `类型「${type.name}」已被 ${templateCount} 个任务定义使用，不能删除`,
      );
    }
    const workers = await this.workers.find();
    if (
      workers.some((w) => (w.taskDefs ?? []).some((d) => d?.type === type.name))
    ) {
      throw new BadRequestException(
        `类型「${type.name}」已被机器人任务定义使用，不能删除`,
      );
    }
    await this.types.remove(type);
  }

  /** 校验类型存在（任务创建/编辑引用时），返回归一化名称；空值原样放行由调用方决定默认值 */
  async assertExists(value: string | null | undefined): Promise<string | null> {
    const name = (value ?? '').trim();
    if (!name) return null;
    const exists = await this.types.findOne({ where: { name } });
    if (!exists) {
      throw new BadRequestException(`任务类型「${name}」不存在`);
    }
    return name;
  }

  /** 名称唯一（英文不区分大小写） */
  private async assertNameAvailable(
    name: string,
    excludeId: number | null,
  ): Promise<void> {
    const rows = await this.types
      .createQueryBuilder('t')
      .where('LOWER(t.name) = LOWER(:name)', { name })
      .getMany();
    if (rows.some((row) => row.id !== excludeId)) {
      throw new BadRequestException(`类型名称「${name}」已存在`);
    }
  }

  /** 改名后同步引用：存量任务、任务定义与机器人任务定义（历史调度方案为快照，不回改） */
  private async renameReferences(from: string, to: string): Promise<void> {
    await this.tasks
      .createQueryBuilder()
      .update(Task)
      .set({ type: to })
      .where('type = :from', { from })
      .execute();
    await this.taskTemplates
      .createQueryBuilder()
      .update(TaskTemplate)
      .set({ type: to })
      .where('type = :from', { from })
      .execute();
    const workers = await this.workers.find();
    for (const worker of workers) {
      if (!(worker.taskDefs ?? []).some((d) => d?.type === from)) continue;
      worker.taskDefs = (worker.taskDefs ?? []).map((d) =>
        d?.type === from ? { ...d, type: to } : d,
      );
      await this.workers.save(worker);
    }
  }
}

import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { TASK_TYPE_DEFAULT } from '../task-types/task-type.entity';
import { TaskTypesService } from '../task-types/task-types.service';
import { Worker } from '../workers/worker.entity';
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

/** 任务定义管理（TaskTemplate）：一类任务的可复用类型、描述与默认处理机器人 */
@Injectable()
export class TaskTemplatesService implements OnModuleInit {
  private readonly logger = new Logger(TaskTemplatesService.name);

  constructor(
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
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

  findAll(): Promise<TaskTemplate[]> {
    return this.templates.find({ order: { updatedAt: 'DESC', id: 'DESC' } });
  }

  async findOne(id: number): Promise<TaskTemplate> {
    const template = await this.templates.findOne({ where: { id } });
    if (!template) {
      throw new NotFoundException(`TaskTemplate ${id} not found`);
    }
    return template;
  }

  async create(input: CreateTaskTemplateInput): Promise<TaskTemplate> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('模板名称不能为空');
    await this.assertNameAvailable(name, null);
    const type =
      (await this.taskTypes.assertExists(input.type)) ?? TASK_TYPE_DEFAULT;
    const agentIds = await this.normalizeAgents(input.agentIds);

    return this.templates.save(
      this.templates.create({
        name,
        type,
        description: input.description?.trim() || null,
        agentIds,
      }),
    );
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

  /** 处理机器人须存在、启用且为工作者（调度机器人不承接任务），并去重 */
  private async normalizeAgents(
    agentIds: number[] | null | undefined,
  ): Promise<number[]> {
    if (!agentIds || agentIds.length === 0) return [];
    const unique = [...new Set(agentIds)];
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
    }
    return unique;
  }
}

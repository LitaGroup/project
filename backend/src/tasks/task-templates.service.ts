import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRole } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import { TaskTemplate } from './task-template.entity';

export interface CreateTaskTemplateInput {
  name: string;
  description?: string | null;
  input?: string | null;
  outputSpec?: string | null;
  agentId?: number | null;
}

export type UpdateTaskTemplateInput = Partial<CreateTaskTemplateInput>;

/** 任务包管理（TaskTemplate）：一类任务的可复用定义（描述/输入/输出 + 默认处理机器人） */
@Injectable()
export class TaskTemplatesService {
  constructor(
    @InjectRepository(TaskTemplate)
    private readonly templates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

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
    const agentId = input.agentId ?? null;
    await this.assertWorker(agentId);

    return this.templates.save(
      this.templates.create({
        name,
        description: input.description?.trim() || null,
        input: input.input?.trim() || null,
        outputSpec: input.outputSpec?.trim() || null,
        agentId,
      }),
    );
  }

  async update(
    id: number,
    input: UpdateTaskTemplateInput,
  ): Promise<TaskTemplate> {
    const template = await this.findOne(id);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('模板名称不能为空');
      await this.assertNameAvailable(name, id);
      template.name = name;
    }
    if (input.description !== undefined) {
      template.description = input.description?.trim() || null;
    }
    if (input.input !== undefined) {
      template.input = input.input?.trim() || null;
    }
    if (input.outputSpec !== undefined) {
      template.outputSpec = input.outputSpec?.trim() || null;
    }
    if (input.agentId !== undefined) {
      await this.assertWorker(input.agentId);
      template.agentId = input.agentId ?? null;
    }
    return this.templates.save(template);
  }

  async remove(id: number): Promise<void> {
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

  /** 处理机器人须存在、启用且为工作者（调度机器人不承接任务） */
  private async assertWorker(agentId: number | null): Promise<void> {
    if (!agentId) return;
    const worker = await this.workers.findOne({ where: { id: agentId } });
    if (!worker) throw new BadRequestException('处理机器人不存在');
    if (!worker.enabled) throw new BadRequestException('处理机器人已停用');
    if (worker.role === WorkerRole.SCHEDULER) {
      throw new BadRequestException('调度机器人不承接任务，请选择工作者');
    }
  }
}

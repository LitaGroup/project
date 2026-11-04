import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from '../workers/worker.entity';
import { WorkflowDefinitionVersion } from './workflow-definition-version.entity';
import { WorkflowDefinition } from './workflow-definition.entity';
import { TEST_TICKET_WORKFLOW } from './system-workflows';
import { normalizeWorkflowDefinition } from './workflow-validation';
import type {
  TicketWorkflowDefinitionDetail,
  TicketWorkflowDefinitionSummary,
  TicketWorkflowPublishedVersion,
  WorkflowDefinitionJson,
} from './workflow.types';

export interface SaveWorkflowDefinitionInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  definition: WorkflowDefinitionJson;
}

export interface WorkflowActor {
  id: number | null;
  name: string;
}

/** 工单定义：系统内置类型的工作流配置、草稿与发布版本。 */
@Injectable()
export class WorkflowDefinitionsService implements OnModuleInit {
  constructor(
    @InjectRepository(WorkflowDefinition)
    private readonly definitions: Repository<WorkflowDefinition>,
    @InjectRepository(WorkflowDefinitionVersion)
    private readonly versions: Repository<WorkflowDefinitionVersion>,
    @InjectRepository(TaskTemplate)
    private readonly taskTemplates: Repository<TaskTemplate>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.definitions.findOne({
      where: [
        { code: TEST_TICKET_WORKFLOW.code },
        { category: TEST_TICKET_WORKFLOW.category },
      ],
    });
    if (existing) return;
    await this.definitions
      .createQueryBuilder()
      .insert()
      .into(WorkflowDefinition)
      .values({
        code: TEST_TICKET_WORKFLOW.code,
        category: TEST_TICKET_WORKFLOW.category,
        name: TEST_TICKET_WORKFLOW.name,
        description: TEST_TICKET_WORKFLOW.description,
        builtIn: true,
        enabled: true,
        draftDefinition: TEST_TICKET_WORKFLOW.definition,
        latestPublishedVersion: 0,
        latestPublishedAt: null,
        draftUpdatedAt: null,
      })
      .orIgnore()
      .execute();
  }

  async findAll(): Promise<TicketWorkflowDefinitionSummary[]> {
    const rows = await this.definitions.find({
      order: { builtIn: 'DESC', id: 'ASC' },
    });
    return rows.map((row) => this.summary(row));
  }

  async findOne(id: number): Promise<TicketWorkflowDefinitionDetail> {
    const definition = await this.mustFind(id);
    const published = definition.latestPublishedVersion
      ? await this.versions.findOne({
          where: {
            definitionId: definition.id,
            version: definition.latestPublishedVersion,
          },
        })
      : null;
    return {
      ...this.summary(definition),
      draft: definition.draftDefinition,
      published: published ? this.publishedView(published) : null,
    };
  }

  async saveDraft(
    id: number,
    input: SaveWorkflowDefinitionInput,
  ): Promise<TicketWorkflowDefinitionDetail> {
    const definition = await this.mustFind(id);
    const normalized = normalizeWorkflowDefinition(input.definition, false);
    await this.assertReferences(normalized, false);
    definition.name =
      typeof input.name === 'string' && input.name.trim()
        ? input.name.trim().slice(0, 100)
        : definition.name;
    definition.description =
      typeof input.description === 'string'
        ? input.description.trim() || null
        : input.description === null
          ? null
          : definition.description;
    if (typeof input.enabled === 'boolean') {
      definition.enabled = input.enabled;
    }
    definition.draftDefinition = normalized;
    definition.draftUpdatedAt = new Date();
    await this.definitions.save(definition);
    return this.findOne(id);
  }

  async publish(
    id: number,
    input: SaveWorkflowDefinitionInput,
    actor: WorkflowActor,
  ): Promise<TicketWorkflowDefinitionDetail> {
    const normalized = normalizeWorkflowDefinition(input.definition, true);
    await this.assertReferences(normalized, true);
    await this.dataSource.transaction(async (manager) => {
      const definition = await manager.findOne(WorkflowDefinition, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!definition) throw new NotFoundException(`工单定义 ${id} 不存在`);
      const publishedAt = new Date();
      const version = definition.latestPublishedVersion + 1;
      const name =
        typeof input.name === 'string' && input.name.trim()
          ? input.name.trim().slice(0, 100)
          : definition.name;
      const description =
        typeof input.description === 'string'
          ? input.description.trim() || null
          : input.description === null
            ? null
            : definition.description;
      const enabled =
        typeof input.enabled === 'boolean' ? input.enabled : definition.enabled;

      await manager.insert(WorkflowDefinitionVersion, {
        definitionId: definition.id,
        version,
        name,
        description,
        definition: normalized,
        publishedById: actor.id,
        publishedByName: actor.name,
        publishedAt,
      });
      await manager.update(WorkflowDefinition, definition.id, {
        name,
        description,
        enabled,
        draftDefinition: normalized,
        latestPublishedVersion: version,
        latestPublishedAt: publishedAt,
        draftUpdatedAt: null,
      });
    });
    return this.findOne(id);
  }

  private async mustFind(id: number): Promise<WorkflowDefinition> {
    const definition = await this.definitions.findOne({ where: { id } });
    if (!definition) {
      throw new NotFoundException(`工单定义 ${id} 不存在`);
    }
    return definition;
  }

  private summary(
    definition: WorkflowDefinition,
  ): TicketWorkflowDefinitionSummary {
    return {
      id: definition.id,
      code: definition.code,
      category: definition.category,
      name: definition.name,
      description: definition.description,
      builtIn: definition.builtIn,
      enabled: definition.enabled,
      latestPublishedVersion: definition.latestPublishedVersion,
      latestPublishedAt: definition.latestPublishedAt,
      draftUpdatedAt: definition.draftUpdatedAt,
      updatedAt: definition.updatedAt,
    };
  }

  private publishedView(
    version: WorkflowDefinitionVersion,
  ): TicketWorkflowPublishedVersion {
    return {
      version: version.version,
      name: version.name,
      description: version.description,
      definition: version.definition,
      publishedById: version.publishedById,
      publishedByName: version.publishedByName,
      publishedAt: version.publishedAt,
    };
  }

  /** 校验流程引用的任务定义与机器人存在；发布时额外要求机器人启用 */
  private async assertReferences(
    definition: WorkflowDefinitionJson,
    strict: boolean,
  ): Promise<void> {
    const templateIds = [
      ...new Set(
        definition.nodes
          .map((node) => node.taskTemplateId)
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const workerIds = [
      ...new Set(
        definition.nodes
          .flatMap((node) => [node.executorWorkerId, node.approverWorkerId])
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const [templates, workers] = await Promise.all([
      templateIds.length
        ? this.taskTemplates.find({
            where: { id: In(templateIds) },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
      workerIds.length
        ? this.workers.find({
            where: { id: In(workerIds) },
            select: {
              id: true,
              name: true,
              enabled: true,
              personalAgentUserId: true,
            },
          })
        : Promise.resolve([]),
    ]);
    const templateById = new Map(
      templates.map((template) => [template.id, template]),
    );
    const workerById = new Map(workers.map((worker) => [worker.id, worker]));
    for (const node of definition.nodes) {
      if (node.taskTemplateId && !templateById.has(node.taskTemplateId)) {
        throw new BadRequestException(
          `节点「${node.name}」选择的任务定义 #${node.taskTemplateId} 不存在`,
        );
      }
      for (const [field, workerId] of [
        ['创建机器人', node.executorWorkerId],
        ['审批机器人', node.approverWorkerId],
      ] as const) {
        if (!workerId) continue;
        const worker = workerById.get(workerId);
        if (!worker) {
          throw new BadRequestException(
            `节点「${node.name}」选择的${field} #${workerId} 不存在`,
          );
        }
        if (worker.personalAgentUserId) {
          throw new BadRequestException(
            `节点「${node.name}」不能使用个人 AGENT 作为${field}`,
          );
        }
        if (strict && !worker.enabled) {
          throw new BadRequestException(
            `节点「${node.name}」选择的${field}「${worker.name}」未启用`,
          );
        }
      }
    }
  }
}

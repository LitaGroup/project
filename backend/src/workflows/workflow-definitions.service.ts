import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { TaskTemplate } from '../tasks/task-template.entity';
import { Worker } from '../workers/worker.entity';
import { WorkflowDefinitionVersion } from './workflow-definition-version.entity';
import { WorkflowDefinition } from './workflow-definition.entity';
import {
  SYSTEM_TICKET_WORKFLOWS,
  buildDefaultWorkflowDefinition,
} from './system-workflows';
import { normalizeWorkflowDefinition } from './workflow-validation';
import type {
  TicketWorkflowDefinitionDetail,
  TicketWorkflowDefinitionSummary,
  TicketWorkflowPublishedVersion,
  WorkflowDefinitionJson,
  WorkflowNodeDefinition,
} from './workflow.types';
import { WORKFLOW_END_NODE } from './workflow.types';

export interface SaveWorkflowDefinitionInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  definition: WorkflowDefinitionJson;
}

export interface CreateWorkflowDefinitionInput {
  name: string;
  description?: string | null;
  definition?: WorkflowDefinitionJson;
}

export interface WorkflowActor {
  id: number | null;
  name: string;
}

/** 把旧版「操作/审批」流程升级为「起始/审批/操作/验收」完整模型 */
function upgradeLegacyWorkflow(raw: unknown): WorkflowDefinitionJson | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<WorkflowDefinitionJson> & {
    startNode?: string;
  };
  type LegacyWorkflowNode = WorkflowNodeDefinition & {
    approverWorkerId?: number | null;
  };
  const nodes: LegacyWorkflowNode[] = Array.isArray(value.nodes)
    ? value.nodes
    : [];
  const hasStart = nodes.some((node) => node?.kind === 'start');
  const hasAcceptance = nodes.some((node) => node?.kind === 'acceptance');
  if (hasStart && hasAcceptance) return null;
  const previousStartKey =
    typeof value.startNode === 'string' && value.startNode
      ? value.startNode
      : (nodes[0]?.key ?? '');
  const first =
    nodes.find((node) => node?.key === previousStartKey) ?? nodes[0];
  if (!first?.key) {
    return normalizeWorkflowDefinition(buildDefaultWorkflowDefinition(), false);
  }
  const usedKeys = new Set(nodes.map((node) => node.key));
  const startKey = usedKeys.has('start') ? 'start-entry' : 'start';
  const acceptanceKey = usedKeys.has('acceptance')
    ? 'acceptance-entry'
    : 'acceptance';
  const upgradedNodes: WorkflowNodeDefinition[] = [
    {
      key: startKey,
      name: '发起工单',
      kind: 'start',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: [],
      autoAccept: false,
      description: '由工单发起机器人填写工单信息。',
    },
    ...nodes.map((node) => ({
      ...node,
      responsibleWorkerId:
        node.kind === 'approval'
          ? (node.responsibleWorkerId ?? node.approverWorkerId ?? null)
          : null,
      inputFields: null,
      autoAccept: node.kind === 'acceptance' ? node.autoAccept === true : false,
    })),
    {
      key: acceptanceKey,
      name: '发起人验收',
      kind: 'acceptance',
      taskTemplateId: null,
      responsibleWorkerId: null,
      inputFields: null,
      autoAccept: false,
      description: '只能由工单发起机器人验收。',
    },
  ];
  const edges = Array.isArray(value.edges) ? value.edges : [];
  const upgradedEdges = edges.map((edge) =>
    edge.to === WORKFLOW_END_NODE ? { ...edge, to: acceptanceKey } : edge,
  );
  upgradedEdges.push({
    from: startKey,
    to: first.key,
    outcome: null,
    label: '开始处理',
  });
  upgradedEdges.push({
    from: acceptanceKey,
    to: WORKFLOW_END_NODE,
    outcome: 'approved',
    label: '验收通过',
  });
  upgradedEdges.push({
    from: acceptanceKey,
    to: first.key,
    outcome: 'rejected',
    label: '验收驳回',
  });
  return normalizeWorkflowDefinition(
    { startNode: startKey, nodes: upgradedNodes, edges: upgradedEdges },
    false,
  );
}

/** 工单配置：工作流定义、草稿与发布版本。 */
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
    for (const workflow of SYSTEM_TICKET_WORKFLOWS) {
      const existing = await this.definitions.findOne({
        where: [{ code: workflow.code }, { category: workflow.category }],
      });
      if (existing) continue;
      await this.definitions
        .createQueryBuilder()
        .insert()
        .into(WorkflowDefinition)
        .values({
          code: workflow.code,
          category: workflow.category,
          name: workflow.name,
          description: workflow.description,
          builtIn: true,
          enabled: true,
          draftDefinition: workflow.definition,
          latestPublishedVersion: 0,
          latestPublishedAt: null,
          draftUpdatedAt: null,
        })
        .orIgnore()
        .execute();
    }
    // 兼容存量草稿：补齐起始/验收节点；不影响已发布不可变版本
    const rows = await this.definitions.find();
    for (const row of rows) {
      const upgraded = upgradeLegacyWorkflow(row.draftDefinition);
      if (!upgraded) continue;
      row.draftDefinition = upgraded;
      row.draftUpdatedAt = new Date();
      await this.definitions.save(row);
    }
  }

  async findAll(): Promise<TicketWorkflowDefinitionSummary[]> {
    const rows = await this.definitions.find({
      order: { id: 'ASC' },
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

  async create(
    input: CreateWorkflowDefinitionInput,
    actor: WorkflowActor,
  ): Promise<TicketWorkflowDefinitionDetail> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('工单配置名称不能为空');
    if (name.length > 100) {
      throw new BadRequestException('工单配置名称不能超过 100 个字符');
    }
    const duplicate = await this.definitions.findOne({ where: { name } });
    if (duplicate) throw new BadRequestException(`工单配置「${name}」已存在`);
    const rawDefinition = input.definition ?? buildDefaultWorkflowDefinition();
    const definition = normalizeWorkflowDefinition(rawDefinition, false);
    await this.assertReferences(definition, false);
    const saved = await this.definitions.save(
      this.definitions.create({
        code: `wf-${randomBytes(5).toString('hex')}`,
        category: name.slice(0, 64),
        name,
        description: input.description?.trim() || null,
        builtIn: false,
        enabled: true,
        draftDefinition: definition,
        latestPublishedVersion: 0,
        latestPublishedAt: null,
        draftUpdatedAt: null,
      }),
    );
    void actor;
    return this.findOne(saved.id);
  }

  async remove(id: number): Promise<void> {
    const definition = await this.mustFind(id);
    if (definition.builtIn) {
      throw new BadRequestException('系统内置工单配置不允许删除');
    }
    const used: Array<{ id: number }> = await this.dataSource.query(
      'SELECT id FROM tickets WHERE "workflowDefinitionId" = $1 LIMIT 1',
      [definition.id],
    );
    if (used.length > 0) {
      throw new BadRequestException('该工单配置已创建工单，不能删除');
    }
    await this.versions.delete({ definitionId: definition.id });
    await this.definitions.delete(definition.id);
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
      if (!definition) throw new NotFoundException(`工单配置 ${id} 不存在`);
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
      throw new NotFoundException(`工单配置 ${id} 不存在`);
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
          .map((node) => node.responsibleWorkerId)
          .filter((id): id is number => Boolean(id)),
      ),
    ];
    const [templates, workers] = await Promise.all([
      templateIds.length
        ? this.taskTemplates.find({
            where: { id: In(templateIds) },
            select: { id: true, name: true, agentIds: true },
          })
        : Promise.resolve([]),
      workerIds.length
        ? this.workers.find({
            where: { id: In(workerIds) },
            select: {
              id: true,
              name: true,
              enabled: true,
              role: true,
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
      if (node.taskTemplateId) {
        const template = templateById.get(node.taskTemplateId);
        if (!template) {
          throw new BadRequestException(
            `节点「${node.name}」选择的任务定义 #${node.taskTemplateId} 不存在`,
          );
        }
        if (
          strict &&
          node.kind === 'operation' &&
          !(template.agentIds ?? []).length
        ) {
          throw new BadRequestException(
            `操作节点「${node.name}」的任务定义「${template.name}」没有处理机器人`,
          );
        }
      }
      const workerId = node.responsibleWorkerId;
      if (!workerId) continue;
      const worker = workerById.get(workerId);
      if (!worker) {
        throw new BadRequestException(
          `节点「${node.name}」选择的负责机器人 #${workerId} 不存在`,
        );
      }
      if (worker.personalAgentUserId) {
        throw new BadRequestException(
          `节点「${node.name}」不能使用个人 AGENT 作为负责机器人`,
        );
      }
      if (strict && !worker.enabled) {
        throw new BadRequestException(
          `节点「${node.name}」选择的负责机器人「${worker.name}」未启用`,
        );
      }
    }
  }
}

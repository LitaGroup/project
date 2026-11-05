/** 工单工作流节点类型：起始 / 审批 / 操作 / 验收 */
export const WORKFLOW_NODE_KINDS = [
  'start',
  'operation',
  'approval',
  'acceptance',
] as const;

export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** 节点执行结果，用于选择连线；终态为特殊节点 `$end` */
export const WORKFLOW_OUTCOMES = [
  'succeeded',
  'failed',
  'approved',
  'rejected',
] as const;

export type WorkflowOutcome = (typeof WORKFLOW_OUTCOMES)[number];

/** 流程结束虚拟节点，不会创建任务；验收通过或操作节点的成功/失败流转可以指向它 */
export const WORKFLOW_END_NODE = '$end';

/** 起始节点支持的输入字段类型 */
export const WORKFLOW_INPUT_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'file',
] as const;

export type WorkflowInputFieldType =
  (typeof WORKFLOW_INPUT_FIELD_TYPES)[number];

/** 起始节点的结构化输入字段 */
export interface WorkflowInputField {
  /** 字段标识，同一节点内唯一，提交后写入 ticket.inputValues */
  key: string;
  /** 字段名称 */
  label: string;
  /** 字段类型 */
  type: WorkflowInputFieldType;
  /** 是否必填 */
  required: boolean;
  /** select 的可选项 */
  options?: string[];
  /** 占位提示 */
  placeholder?: string | null;
  /** 默认值（file 不支持） */
  defaultValue?: string | number | null;
}

export interface WorkflowNodeDefinition {
  /** 节点稳定标识，同一版本内唯一 */
  key: string;
  /** 节点名称 */
  name: string;
  /** 起始 / 审批 / 操作 / 验收 */
  kind: WorkflowNodeKind;
  /** 节点使用的任务定义（task_templates.id）；审批/操作节点发布时必填 */
  taskTemplateId: number | null;
  /** 节点负责机器人（workers.id）；审批节点发布时必填，操作节点由任务定义自动分配 */
  responsibleWorkerId: number | null;
  /** 起始节点输入字段清单；仅起始节点可配置 */
  inputFields: WorkflowInputField[] | null;
  /** 验收节点自动验收；前序成功到达验收时直接验收通过完成工单 */
  autoAccept: boolean;
  /** 节点说明，作为节点任务上下文 */
  description: string | null;
}

export interface WorkflowEdgeDefinition {
  /** 来源节点 */
  from: string;
  /** 目标节点；`$end` 表示流程结束 */
  to: string;
  /** 为空表示无条件流转；审批/验收使用 approved/rejected，操作使用 succeeded/failed */
  outcome: WorkflowOutcome | null;
  /** 展示文案 */
  label: string | null;
}

export interface WorkflowDefinitionJson {
  /** 起始节点 key（当前模型固定为唯一的起始节点 key） */
  startNode: string;
  /** 节点清单 */
  nodes: WorkflowNodeDefinition[];
  /** 流转规则 */
  edges: WorkflowEdgeDefinition[];
}

export interface TicketWorkflowDefinitionSummary {
  id: number;
  code: string;
  category: string;
  name: string;
  description: string | null;
  builtIn: boolean;
  enabled: boolean;
  latestPublishedVersion: number;
  latestPublishedAt: Date | null;
  draftUpdatedAt: Date | null;
  updatedAt: Date;
}

export interface TicketWorkflowPublishedVersion {
  version: number;
  name: string;
  description: string | null;
  definition: WorkflowDefinitionJson;
  publishedById: number | null;
  publishedByName: string | null;
  publishedAt: Date;
}

export interface TicketWorkflowDefinitionDetail extends TicketWorkflowDefinitionSummary {
  draft: WorkflowDefinitionJson;
  published: TicketWorkflowPublishedVersion | null;
}

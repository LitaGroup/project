/** 工单工作流节点类型：起始 / 操作 / 审批 / 验收 / 判断 */
export const WORKFLOW_NODE_KINDS = [
  'start',
  'operation',
  'approval',
  'acceptance',
  'condition',
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

/** 流程结束虚拟节点，不会创建任务；验收通过、审批通过/驳回或操作节点的成功/失败流转可以指向它 */
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

/** 判断节点支持的比较运算符 */
export const WORKFLOW_CONDITION_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'empty',
  'notEmpty',
] as const;

export type WorkflowConditionOperator =
  (typeof WORKFLOW_CONDITION_OPERATORS)[number];

/**
 * 判断节点出边的单条条件；同一出边的多条条件之间为「且」关系。
 * field 引用起始节点 inputFields 的 key，运行时读取 ticket.inputValues。
 */
export interface WorkflowConditionRule {
  /** 起始节点输入字段标识 */
  field: string;
  /** 比较运算符 */
  operator: WorkflowConditionOperator;
  /** 比较值；empty / notEmpty 不需要 */
  value?: string | null;
}

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
  /** 起始 / 操作 / 审批 / 验收 / 判断 */
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
  /** 判断节点出边的条件（多条之间为「且」）；为空表示默认兜底分支 */
  conditions?: WorkflowConditionRule[] | null;
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

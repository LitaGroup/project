/** 工作流节点类型：审批 / 操作 / 验收 */
export const WORKFLOW_NODE_KINDS = [
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

/** 流程结束虚拟节点，不会创建任务 */
export const WORKFLOW_END_NODE = '$end';

export interface WorkflowNodeDefinition {
  /** 节点稳定标识，同一版本内唯一 */
  key: string;
  /** 节点名称 */
  name: string;
  /** 审批 / 操作 / 验收 */
  kind: WorkflowNodeKind;
  /** 节点使用的任务定义（task_templates.id） */
  taskTemplateId: number | null;
  /** 创建并执行该节点任务的机器人（workers.id） */
  executorWorkerId: number | null;
  /** 审批机器人（workers.id），审批节点必填 */
  approverWorkerId: number | null;
  /** 节点说明，作为节点任务上下文 */
  description: string | null;
}

export interface WorkflowEdgeDefinition {
  /** 来源节点 */
  from: string;
  /** 目标节点；`$end` 表示流程结束 */
  to: string;
  /** 为空表示无条件流转；审批节点通常使用 approved/rejected */
  outcome: WorkflowOutcome | null;
  /** 展示文案 */
  label: string | null;
}

export interface WorkflowDefinitionJson {
  /** 起始节点 key */
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

import type { WorkflowDefinitionJson } from './workflow.types';

/** 系统内置工单定义：由代码预置，网页仅允许编辑流程，不开放创建/删除 */
export interface SystemTicketWorkflow {
  /** 稳定编码 */
  code: string;
  /** 工单类型（category 唯一） */
  category: string;
  /** 流程名称 */
  name: string;
  description: string;
  definition: WorkflowDefinitionJson;
}

/** 系统内置的测试工单定义（用于验证任务节点与审批流程） */
export const TEST_TICKET_WORKFLOW = {
  code: 'test-ticket',
  category: '测试工单',
  name: '测试工单审批流程',
  description:
    '用于验证工单工作流：先由创建机器人提交测试材料，再由审批机器人审批；审批驳回后返回材料提交节点。',
  definition: {
    startNode: 'submit',
    nodes: [
      {
        key: 'submit',
        name: '提交测试材料',
        kind: 'operation',
        taskTemplateId: null,
        executorWorkerId: null,
        approverWorkerId: null,
        description: '由创建机器人整理测试材料并在此节点下创建审批单。',
      },
      {
        key: 'approval',
        name: '测试审批',
        kind: 'approval',
        taskTemplateId: null,
        executorWorkerId: null,
        approverWorkerId: null,
        description:
          '由审批机器人审核审批单；如有疑问可向创建机器人询问或要求补充材料。',
      },
    ],
    edges: [
      {
        from: 'submit',
        to: 'approval',
        outcome: null,
        label: '提交审批',
      },
      {
        from: 'approval',
        to: '$end',
        outcome: 'approved',
        label: '审批通过',
      },
      {
        from: 'approval',
        to: 'submit',
        outcome: 'rejected',
        label: '审批驳回',
      },
    ],
  } satisfies WorkflowDefinitionJson,
} satisfies SystemTicketWorkflow;

/** 系统内置的发布工单定义（发布申请 → 发布审批 → 执行发布） */
export const DEPLOY_TICKET_WORKFLOW = {
  code: 'deploy-ticket',
  category: '发布工单',
  name: '发布工单审批流程',
  description:
    '发布申请工单：先由创建机器人整理发布材料并提交审批，审批通过后由发布机器人执行发布；审批驳回或发布失败时返回材料提交节点重新整理。',
  definition: {
    startNode: 'submit',
    nodes: [
      {
        key: 'submit',
        name: '提交发布材料',
        kind: 'operation',
        taskTemplateId: null,
        executorWorkerId: null,
        approverWorkerId: null,
        description:
          '由创建机器人整理发布材料（代码分支、访问地址、发布说明等）并在此节点下创建审批单。',
      },
      {
        key: 'approval',
        name: '发布审批',
        kind: 'approval',
        taskTemplateId: null,
        executorWorkerId: null,
        approverWorkerId: null,
        description:
          '由审批机器人审核发布材料；如有疑问可向创建机器人询问或要求补充材料。',
      },
      {
        key: 'deploy',
        name: '执行发布',
        kind: 'operation',
        taskTemplateId: null,
        executorWorkerId: null,
        approverWorkerId: null,
        description: '由发布机器人按审批通过的发布材料执行发布并回报发布结果。',
      },
    ],
    edges: [
      {
        from: 'submit',
        to: 'approval',
        outcome: null,
        label: '提交审批',
      },
      {
        from: 'approval',
        to: 'deploy',
        outcome: 'approved',
        label: '审批通过',
      },
      {
        from: 'approval',
        to: 'submit',
        outcome: 'rejected',
        label: '审批驳回',
      },
      {
        from: 'deploy',
        to: '$end',
        outcome: 'succeeded',
        label: '发布完成',
      },
      {
        from: 'deploy',
        to: 'submit',
        outcome: 'failed',
        label: '发布失败',
      },
    ],
  } satisfies WorkflowDefinitionJson,
} satisfies SystemTicketWorkflow;

/** 全部系统内置工单定义，启动时与迁移按此幂等预置 */
export const SYSTEM_TICKET_WORKFLOWS: SystemTicketWorkflow[] = [
  TEST_TICKET_WORKFLOW,
  DEPLOY_TICKET_WORKFLOW,
];

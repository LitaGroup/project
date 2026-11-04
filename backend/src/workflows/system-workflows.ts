import type { WorkflowDefinitionJson } from './workflow.types';

/** 系统内置的唯一测试工单定义（用于验证任务节点与审批流程） */
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
};

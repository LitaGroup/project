import type { WorkflowDefinitionJson } from './workflow.types';

/** 系统内置工单工作流：由代码预置，网页仅允许编辑、停用，不开放删除 */
export interface SystemTicketWorkflow {
  /** 稳定编码 */
  code: string;
  /** 工单类型（历史兼容字段，新模型以流程名称为准） */
  category: string;
  /** 流程名称 */
  name: string;
  description: string;
  definition: WorkflowDefinitionJson;
}

const inputFields = (descriptionRequired = true) => [
  {
    key: 'title',
    label: '标题',
    type: 'text' as const,
    required: true,
    placeholder: '一句话说明本次工单',
    defaultValue: null,
  },
  {
    key: 'description',
    label: '详细说明',
    type: 'textarea' as const,
    required: descriptionRequired,
    placeholder: '补充背景、现状、期望结果与时间要求',
    defaultValue: null,
  },
];

/** 系统内置的测试工单定义（用于验证起始、审批、操作与验收四类节点） */
export const TEST_TICKET_WORKFLOW = {
  code: 'test-ticket',
  category: '测试工单',
  name: '测试工单审批流程',
  description:
    '用于验证工单工作流：发起人填写测试材料，操作机器人提交材料，审批机器人审批，最后由发起人验收。',
  definition: {
    startNode: 'start',
    nodes: [
      {
        key: 'start',
        name: '发起测试工单',
        kind: 'start',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: inputFields(),
        autoAccept: false,
        description: '由工单发起机器人填写测试背景、范围与期望结果。',
      },
      {
        key: 'submit',
        name: '提交测试材料',
        kind: 'operation',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '由任务定义自动分配的机器人整理测试材料并提交审批。',
      },
      {
        key: 'approval',
        name: '测试审批',
        kind: 'approval',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '由负责机器人审核测试材料；如有疑问可向发起机器人询问。',
      },
      {
        key: 'acceptance',
        name: '发起人验收',
        kind: 'acceptance',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '只能由工单发起机器人验收；驳回后回到材料提交节点。',
      },
    ],
    edges: [
      { from: 'start', to: 'submit', outcome: null, label: '开始处理' },
      {
        from: 'submit',
        to: 'approval',
        outcome: 'succeeded',
        label: '提交审批',
      },
      {
        from: 'approval',
        to: 'acceptance',
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
        from: 'acceptance',
        to: '$end',
        outcome: 'approved',
        label: '验收通过',
      },
      {
        from: 'acceptance',
        to: 'submit',
        outcome: 'rejected',
        label: '验收驳回',
      },
    ],
  } satisfies WorkflowDefinitionJson,
} satisfies SystemTicketWorkflow;

/** 系统内置的发布工单定义（发起 → 提交材料 → 发布审批 → 执行发布 → 验收） */
export const DEPLOY_TICKET_WORKFLOW = {
  code: 'deploy-ticket',
  category: '发布工单',
  name: '发布工单审批流程',
  description:
    '发布申请工单：发起人填写发布材料，机器人整理并提交审批，审批通过后执行发布，最后由发起人验收。',
  definition: {
    startNode: 'start',
    nodes: [
      {
        key: 'start',
        name: '发起发布工单',
        kind: 'start',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: inputFields(),
        autoAccept: false,
        description: '由工单发起机器人填写代码分支、访问地址与发布说明。',
      },
      {
        key: 'submit',
        name: '整理发布材料',
        kind: 'operation',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '由任务定义自动分配的机器人核对发布材料并提交审批。',
      },
      {
        key: 'approval',
        name: '发布审批',
        kind: 'approval',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '由负责机器人审核发布材料；如有疑问可向发起机器人询问。',
      },
      {
        key: 'deploy',
        name: '执行发布',
        kind: 'operation',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '由任务定义自动分配的机器人按审批通过的发布材料执行发布。',
      },
      {
        key: 'acceptance',
        name: '发起人验收',
        kind: 'acceptance',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '只能由工单发起机器人验收；驳回后回到材料整理节点。',
      },
    ],
    edges: [
      { from: 'start', to: 'submit', outcome: null, label: '开始处理' },
      {
        from: 'submit',
        to: 'approval',
        outcome: 'succeeded',
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
        to: 'acceptance',
        outcome: 'succeeded',
        label: '发布完成',
      },
      { from: 'deploy', to: 'submit', outcome: 'failed', label: '发布失败' },
      {
        from: 'acceptance',
        to: '$end',
        outcome: 'approved',
        label: '验收通过',
      },
      {
        from: 'acceptance',
        to: 'submit',
        outcome: 'rejected',
        label: '验收驳回',
      },
    ],
  } satisfies WorkflowDefinitionJson,
} satisfies SystemTicketWorkflow;

/** 全部系统内置工单工作流，启动时与迁移按此幂等预置 */
export const SYSTEM_TICKET_WORKFLOWS: SystemTicketWorkflow[] = [
  TEST_TICKET_WORKFLOW,
  DEPLOY_TICKET_WORKFLOW,
];

/** 网页新建工单配置的默认流程骨架 */
export function buildDefaultWorkflowDefinition(): WorkflowDefinitionJson {
  return {
    startNode: 'start',
    nodes: [
      {
        key: 'start',
        name: '发起工单',
        kind: 'start',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: inputFields(),
        autoAccept: false,
        description: '由工单发起机器人填写必要信息。',
      },
      {
        key: 'acceptance',
        name: '发起人验收',
        kind: 'acceptance',
        taskTemplateId: null,
        responsibleWorkerId: null,
        inputFields: null,
        autoAccept: false,
        description: '只能由工单发起机器人验收。',
      },
    ],
    edges: [
      { from: 'start', to: 'acceptance', outcome: null, label: '直接验收' },
      {
        from: 'acceptance',
        to: '$end',
        outcome: 'approved',
        label: '验收通过',
      },
    ],
  };
}

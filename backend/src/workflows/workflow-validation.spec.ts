import { BadRequestException } from '@nestjs/common';
import { normalizeWorkflowDefinition } from './workflow-validation';
import type { WorkflowDefinitionJson } from './workflow.types';

const node = (
  key: string,
  kind: 'operation' | 'approval' | 'acceptance' = 'operation',
) => ({
  key,
  name: key,
  kind,
  taskTemplateId: 1001,
  executorWorkerId: 1001,
  approverWorkerId: kind === 'approval' ? 1002 : null,
  description: null,
});

const validDefinition = (): WorkflowDefinitionJson => ({
  startNode: 'submit',
  nodes: [node('submit'), node('approval', 'approval')],
  edges: [
    { from: 'submit', to: 'approval', outcome: null, label: null },
    {
      from: 'approval',
      to: '$end',
      outcome: 'approved',
      label: null,
    },
    {
      from: 'approval',
      to: 'submit',
      outcome: 'rejected',
      label: null,
    },
  ],
});

describe('normalizeWorkflowDefinition', () => {
  it('接受完整的审批流程', () => {
    expect(normalizeWorkflowDefinition(validDefinition(), true)).toEqual(
      validDefinition(),
    );
  });

  it('草稿允许暂未选择任务定义与机器人', () => {
    const definition = validDefinition();
    definition.nodes = definition.nodes.map((item) => ({
      ...item,
      taskTemplateId: null,
      executorWorkerId: null,
      approverWorkerId: null,
    }));
    expect(() => normalizeWorkflowDefinition(definition, false)).not.toThrow();
    expect(() => normalizeWorkflowDefinition(definition, true)).toThrow(
      '未选择任务定义',
    );
  });

  it('发布时拒绝从起始节点不可达的节点', () => {
    const definition = validDefinition();
    definition.nodes.push(node('unreachable'));
    definition.edges.push({
      from: 'unreachable',
      to: '$end',
      outcome: null,
      label: null,
    });
    expect(() => normalizeWorkflowDefinition(definition, true)).toThrow(
      '无法从起始节点到达',
    );
  });

  it('发布时拒绝没有到达结束路径的节点', () => {
    const definition = validDefinition();
    definition.nodes.push(node('trapped-1'), node('trapped-2'));
    definition.edges[0].outcome = 'succeeded';
    definition.edges.push(
      {
        from: 'submit',
        to: 'trapped-1',
        outcome: 'failed',
        label: null,
      },
      {
        from: 'trapped-1',
        to: 'trapped-2',
        outcome: null,
        label: null,
      },
      {
        from: 'trapped-2',
        to: 'trapped-1',
        outcome: null,
        label: null,
      },
    );
    expect(() => normalizeWorkflowDefinition(definition, true)).toThrow(
      '没有可到达流程结束的路径',
    );
  });

  it('拒绝重复节点标识', () => {
    const definition = validDefinition();
    definition.nodes.push(node('submit'));
    expect(() => normalizeWorkflowDefinition(definition, false)).toThrow(
      BadRequestException,
    );
  });

  it('拒绝不存在的目标节点', () => {
    const definition = validDefinition();
    definition.edges[0].to = 'missing';
    expect(() => normalizeWorkflowDefinition(definition, false)).toThrow(
      '目标节点「missing」不存在',
    );
  });

  it('发布时要求审批节点配置审批机器人', () => {
    const definition = validDefinition();
    definition.nodes[1].approverWorkerId = null;
    expect(() => normalizeWorkflowDefinition(definition, true)).toThrow(
      '未选择审批机器人',
    );
  });

  it('拒绝同一节点相同结果的重复流转', () => {
    const definition = validDefinition();
    definition.edges.push({
      from: 'approval',
      to: '$end',
      outcome: 'approved',
      label: null,
    });
    expect(() => normalizeWorkflowDefinition(definition, false)).toThrow(
      '存在重复流转',
    );
  });
});

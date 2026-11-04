import { BadRequestException } from '@nestjs/common';
import {
  WORKFLOW_END_NODE,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTCOMES,
  type WorkflowDefinitionJson,
  type WorkflowEdgeDefinition,
  type WorkflowNodeDefinition,
  type WorkflowNodeKind,
  type WorkflowOutcome,
} from './workflow.types';

const NODE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function bad(message: string): never {
  throw new BadRequestException(message);
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    bad(`${field}不能为空`);
  }
  const result = value.trim();
  if (result.length > maxLength) {
    bad(`${field}不能超过 ${maxLength} 个字符`);
  }
  return result;
}

function optionalText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') bad(`${field}格式不正确`);
  const result = value.trim();
  if (!result) return null;
  if (result.length > maxLength) {
    bad(`${field}不能超过 ${maxLength} 个字符`);
  }
  return result;
}

function nullableId(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    bad(`${field}必须是正整数`);
  }
  return parsed;
}

function normalizeNode(value: unknown, index: number): WorkflowNodeDefinition {
  if (!value || typeof value !== 'object') {
    bad(`第 ${index + 1} 个节点格式不正确`);
  }
  const item = value as Record<string, unknown>;
  const key = text(item.key, `第 ${index + 1} 个节点标识`, 64);
  if (!NODE_KEY_PATTERN.test(key)) {
    bad(
      `节点标识「${key}」格式不正确：需以英文字母开头，仅包含字母、数字、下划线或短横线`,
    );
  }
  const kind = typeof item.kind === 'string' ? item.kind : '';
  if (!(WORKFLOW_NODE_KINDS as readonly string[]).includes(kind)) {
    bad(`节点「${key}」的类型不正确`);
  }
  return {
    key,
    name: text(item.name, `节点「${key}」的名称`, 100),
    kind: kind as WorkflowNodeKind,
    taskTemplateId: nullableId(item.taskTemplateId, `节点「${key}」的任务定义`),
    executorWorkerId: nullableId(
      item.executorWorkerId,
      `节点「${key}」的创建机器人`,
    ),
    approverWorkerId:
      kind === 'approval'
        ? nullableId(item.approverWorkerId, `节点「${key}」的审批机器人`)
        : null,
    description: optionalText(
      item.description,
      `节点「${key}」的节点说明`,
      10000,
    ),
  };
}

function normalizeEdge(value: unknown, index: number): WorkflowEdgeDefinition {
  if (!value || typeof value !== 'object') {
    bad(`第 ${index + 1} 条流转规则格式不正确`);
  }
  const item = value as Record<string, unknown>;
  const from = text(item.from, `第 ${index + 1} 条流转规则的来源节点`, 64);
  const to = text(item.to, `第 ${index + 1} 条流转规则的目标节点`, 64);
  let outcome: WorkflowOutcome | null = null;
  if (
    item.outcome !== null &&
    item.outcome !== undefined &&
    item.outcome !== ''
  ) {
    if (typeof item.outcome !== 'string') {
      bad(`第 ${index + 1} 条流转规则的结果格式不正确`);
    }
    const valueText = item.outcome;
    if (!(WORKFLOW_OUTCOMES as readonly string[]).includes(valueText)) {
      bad(`流转规则不支持结果「${valueText}」`);
    }
    outcome = valueText as WorkflowOutcome;
  }
  return {
    from,
    to,
    outcome,
    label:
      optionalText(item.label, `第 ${index + 1} 条流转规则的展示文案`, 100) ??
      null,
  };
}

/**
 * 结构校验与归一化。
 * strict=false 用于保存草稿，允许尚未选择任务定义/机器人；
 * strict=true 用于发布，要求流程可完整执行且所有节点最终都能到达结束。
 */
export function normalizeWorkflowDefinition(
  value: unknown,
  strict: boolean,
): WorkflowDefinitionJson {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    bad('流程定义格式不正确');
  }
  const input = value as Record<string, unknown>;
  if (!Array.isArray(input.nodes)) bad('节点列表格式不正确');
  if (!Array.isArray(input.edges)) bad('流转规则列表格式不正确');
  const nodes = input.nodes.map(normalizeNode);
  const edges = input.edges.map(normalizeEdge);
  const startNode =
    typeof input.startNode === 'string' ? input.startNode.trim() : '';

  if (nodes.length === 0) {
    if (strict) bad('流程至少需要一个节点');
    return { startNode: '', nodes, edges };
  }

  const nodeByKey = new Map<string, WorkflowNodeDefinition>();
  for (const node of nodes) {
    if (nodeByKey.has(node.key)) bad(`节点标识「${node.key}」重复`);
    nodeByKey.set(node.key, node);
  }
  if (!startNode) bad('请选择起始节点');
  if (!nodeByKey.has(startNode)) bad(`起始节点「${startNode}」不存在`);

  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!nodeByKey.has(edge.from)) {
      bad(`流转规则的来源节点「${edge.from}」不存在`);
    }
    if (edge.to !== WORKFLOW_END_NODE && !nodeByKey.has(edge.to)) {
      bad(`流转规则的目标节点「${edge.to}」不存在`);
    }
    if (edge.to === edge.from) bad(`节点「${edge.from}」不能流转到自身`);
    const edgeKey = `${edge.from}\u0000${edge.outcome ?? '__unconditional__'}`;
    if (edgeKeys.has(edgeKey)) {
      bad(
        edge.outcome
          ? `节点「${edge.from}」的结果「${edge.outcome}」存在重复流转`
          : `节点「${edge.from}」存在重复的无条件流转`,
      );
    }
    edgeKeys.add(edgeKey);
  }

  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.from === node.key);
    if (strict && outgoing.length === 0) {
      bad(`节点「${node.name}」没有配置后续流转`);
    }
    if (outgoing.length > 1 && outgoing.some((edge) => !edge.outcome)) {
      bad(`节点「${node.name}」存在多条流转时，每条流转都必须指定结果`);
    }
    if (strict && !node.taskTemplateId) {
      bad(`节点「${node.name}」未选择任务定义`);
    }
    if (strict && !node.executorWorkerId) {
      bad(`节点「${node.name}」未选择创建机器人`);
    }
    if (strict && node.kind === 'approval' && !node.approverWorkerId) {
      bad(`审批节点「${node.name}」未选择审批机器人`);
    }
  }

  if (strict) {
    if (!edges.some((edge) => edge.to === WORKFLOW_END_NODE)) {
      bad('流程至少需要一条到达结束的流转');
    }

    // 从起始节点出发是否所有节点都可到达
    const reachable = new Set<string>([startNode]);
    const queue = [startNode];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of edges.filter((item) => item.from === current)) {
        if (edge.to !== WORKFLOW_END_NODE && !reachable.has(edge.to)) {
          reachable.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
    const unreachable = nodes.filter((node) => !reachable.has(node.key));
    if (unreachable.length) {
      bad(
        `节点「${unreachable.map((node) => node.name).join('、')}」无法从起始节点到达`,
      );
    }

    // 每个节点最终都必须存在到达结束的路径
    const canReachEnd = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (canReachEnd.has(node.key)) continue;
        const outgoing = edges.filter((edge) => edge.from === node.key);
        if (
          outgoing.some(
            (edge) => edge.to === WORKFLOW_END_NODE || canReachEnd.has(edge.to),
          )
        ) {
          canReachEnd.add(node.key);
          changed = true;
        }
      }
    }
    const trapped = nodes.filter((node) => !canReachEnd.has(node.key));
    if (trapped.length) {
      bad(
        `节点「${trapped.map((node) => node.name).join('、')}」没有可到达流程结束的路径`,
      );
    }
  }

  return { startNode, nodes, edges };
}

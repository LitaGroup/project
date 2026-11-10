import { BadRequestException } from '@nestjs/common';
import {
  WORKFLOW_CONDITION_OPERATORS,
  WORKFLOW_END_NODE,
  WORKFLOW_INPUT_FIELD_TYPES,
  WORKFLOW_NODE_KINDS,
  WORKFLOW_OUTCOMES,
  type WorkflowConditionOperator,
  type WorkflowConditionRule,
  type WorkflowDefinitionJson,
  type WorkflowEdgeDefinition,
  type WorkflowInputField,
  type WorkflowInputFieldType,
  type WorkflowNodeDefinition,
  type WorkflowNodeKind,
  type WorkflowOutcome,
} from './workflow.types';

const NODE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const FIELD_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

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

function normalizeInputFields(
  value: unknown,
  nodeKey: string,
): WorkflowInputField[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) bad(`起始节点「${nodeKey}」的输入字段格式不正确`);
  const fields: WorkflowInputField[] = [];
  const keys = new Set<string>();
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      bad(`起始节点「${nodeKey}」第 ${index + 1} 个输入字段格式不正确`);
    }
    const item = raw as Record<string, unknown>;
    const key = text(
      item.key,
      `起始节点「${nodeKey}」第 ${index + 1} 个输入字段标识`,
      64,
    );
    if (!FIELD_KEY_PATTERN.test(key)) {
      bad(
        `输入字段「${key}」格式不正确：需以英文字母开头，仅包含字母、数字或下划线`,
      );
    }
    if (keys.has(key)) bad(`输入字段标识「${key}」重复`);
    keys.add(key);
    const type = typeof item.type === 'string' ? item.type : '';
    if (!(WORKFLOW_INPUT_FIELD_TYPES as readonly string[]).includes(type)) {
      bad(`输入字段「${key}」的类型不正确`);
    }
    const options =
      type === 'select'
        ? (Array.isArray(item.options) ? item.options : [])
            .map((option) => String(option ?? '').trim())
            .filter(Boolean)
        : undefined;
    if (type === 'select' && (!options || options.length === 0)) {
      bad(`单选字段「${key}」至少需要一个选项`);
    }
    const rawDefault = item.defaultValue;
    const defaultValue =
      type === 'file' ||
      rawDefault === null ||
      rawDefault === undefined ||
      rawDefault === ''
        ? null
        : typeof rawDefault === 'string'
          ? rawDefault
          : typeof rawDefault === 'number' ||
              typeof rawDefault === 'boolean' ||
              typeof rawDefault === 'bigint'
            ? rawDefault.toString()
            : JSON.stringify(rawDefault);
    fields.push({
      key,
      label: text(item.label, `输入字段「${key}」的名称`, 100),
      type: type as WorkflowInputFieldType,
      required: item.required === true,
      ...(options ? { options } : {}),
      placeholder: optionalText(
        item.placeholder,
        `输入字段「${key}」的占位提示`,
        200,
      ),
      defaultValue,
    });
  });
  return fields;
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
  const nodeKind = kind as WorkflowNodeKind;
  // 兼容历史配置字段：审批机器人即现在的负责机器人；操作节点不再使用固定创建机器人。
  const legacyResponsible =
    item.responsibleWorkerId ?? item.approverWorkerId ?? null;
  return {
    key,
    name: text(item.name, `节点「${key}」的名称`, 100),
    kind: nodeKind,
    taskTemplateId: nullableId(item.taskTemplateId, `节点「${key}」的任务定义`),
    responsibleWorkerId:
      nodeKind === 'approval'
        ? nullableId(legacyResponsible, `审批节点「${key}」的负责机器人`)
        : null,
    inputFields:
      nodeKind === 'start' ? normalizeInputFields(item.inputFields, key) : null,
    autoAccept: nodeKind === 'acceptance' ? item.autoAccept === true : false,
    description: optionalText(
      item.description,
      `节点「${key}」的节点说明`,
      10000,
    ),
  };
}

function normalizeConditions(
  value: unknown,
  edgeIndex: number,
): WorkflowConditionRule[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    bad(`第 ${edgeIndex + 1} 条流转规则的条件格式不正确`);
  }
  const rules: WorkflowConditionRule[] = [];
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      bad(`第 ${edgeIndex + 1} 条流转规则的第 ${index + 1} 个条件格式不正确`);
    }
    const item = raw as Record<string, unknown>;
    const field = text(
      item.field,
      `第 ${edgeIndex + 1} 条流转规则第 ${index + 1} 个条件的字段`,
      64,
    );
    if (!FIELD_KEY_PATTERN.test(field)) {
      bad(
        `条件字段「${field}」格式不正确：需以英文字母开头，仅包含字母、数字或下划线`,
      );
    }
    const operator =
      typeof item.operator === 'string' ? item.operator.trim() : '';
    if (
      !(WORKFLOW_CONDITION_OPERATORS as readonly string[]).includes(operator)
    ) {
      bad(`条件字段「${field}」的运算符「${operator}」不正确`);
    }
    const conditionOperator = operator as WorkflowConditionOperator;
    const needsValue =
      conditionOperator !== 'empty' && conditionOperator !== 'notEmpty';
    const rawValue = item.value;
    const conditionValue =
      !needsValue || rawValue === null || rawValue === undefined
        ? null
        : typeof rawValue === 'string'
          ? rawValue
          : typeof rawValue === 'number' ||
              typeof rawValue === 'boolean' ||
              typeof rawValue === 'bigint'
            ? rawValue.toString()
            : JSON.stringify(rawValue);
    if (needsValue && !conditionValue?.trim()) {
      bad(`条件字段「${field}」的比较值不能为空`);
    }
    rules.push({
      field,
      operator: conditionOperator,
      value: conditionValue,
    });
  });
  return rules.length ? rules : null;
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
  const conditions = normalizeConditions(item.conditions, index);
  return {
    from,
    to,
    outcome,
    ...(conditions ? { conditions } : {}),
    label:
      optionalText(item.label, `第 ${index + 1} 条流转规则的展示文案`, 100) ??
      null,
  };
}

function outgoingOutcomes(node: WorkflowNodeDefinition): WorkflowOutcome[] {
  if (node.kind === 'approval' || node.kind === 'acceptance') {
    return node.kind === 'approval'
      ? ['approved', 'rejected']
      : ['approved', 'rejected'];
  }
  if (node.kind === 'operation') return ['succeeded', 'failed'];
  return [];
}

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 判断节点条件允许的运算符；文件类型不参与判断 */
function conditionOperatorsForType(
  type: WorkflowInputFieldType,
): WorkflowConditionOperator[] {
  switch (type) {
    case 'number':
    case 'date':
      return ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'notEmpty'];
    case 'text':
    case 'textarea':
      return ['eq', 'ne', 'contains', 'empty', 'notEmpty'];
    case 'select':
      return ['eq', 'ne', 'empty', 'notEmpty'];
    default:
      return [];
  }
}

/**
 * 结构校验与归一化。
 * strict=false 用于保存草稿，允许尚未选择任务定义/机器人；
 * strict=true 用于发布，要求四类节点完整、引用可执行且所有路径最终可以结束。
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
    if (strict) bad('流程至少需要起始、验收两类节点');
    return { startNode: '', nodes, edges };
  }

  const nodeByKey = new Map<string, WorkflowNodeDefinition>();
  for (const node of nodes) {
    if (nodeByKey.has(node.key)) bad(`节点标识「${node.key}」重复`);
    nodeByKey.set(node.key, node);
  }
  const startNodes = nodes.filter((node) => node.kind === 'start');
  const acceptanceNodes = nodes.filter((node) => node.kind === 'acceptance');
  if (strict) {
    if (startNodes.length !== 1) bad('流程必须有且只有一个起始节点');
    if (acceptanceNodes.length === 0) bad('流程至少有一个验收节点');
  }
  if (startNodes.length === 1) {
    if (startNode && startNode !== startNodes[0].key) {
      bad('起始节点配置与 startNode 不一致');
    }
  } else if (!startNode) {
    bad('请选择起始节点');
  }
  if (startNode && !nodeByKey.has(startNode)) {
    bad(`起始节点「${startNode}」不存在`);
  }

  const inputFieldByKey = new Map<string, WorkflowInputField>(
    (startNodes[0]?.inputFields ?? []).map((field) => [field.key, field]),
  );

  const edgeKeys = new Set<string>();
  for (const edge of edges) {
    if (!nodeByKey.has(edge.from)) {
      bad(`流转规则的来源节点「${edge.from}」不存在`);
    }
    if (edge.to !== WORKFLOW_END_NODE && !nodeByKey.has(edge.to)) {
      bad(`流转规则的目标节点「${edge.to}」不存在`);
    }
    if (edge.to === edge.from) bad(`节点「${edge.from}」不能流转到自身`);
    const source = nodeByKey.get(edge.from)!;
    if (source.kind === 'condition') {
      if (edge.outcome) bad('判断节点的流转不能指定结果');
    } else {
      if (edge.conditions?.length) {
        bad(`节点「${source.name}」不是判断节点，不能配置流转条件`);
      }
      if (source.kind === 'start') {
        if (edge.outcome) bad('起始节点的流转不能指定结果');
      } else if (edge.outcome) {
        const allowed = outgoingOutcomes(source);
        if (!allowed.includes(edge.outcome)) {
          bad(`节点「${source.name}」不支持流转结果「${edge.outcome}」`);
        }
      }
    }
    for (const rule of edge.conditions ?? []) {
      const field = inputFieldByKey.get(rule.field);
      if (!field) {
        bad(
          `节点「${source.name}」的条件字段「${rule.field}」不在起始节点输入字段中`,
        );
      }
      if (!conditionOperatorsForType(field.type).includes(rule.operator)) {
        bad(`条件字段「${field.label}」不支持运算符「${rule.operator}」`);
      }
      if (rule.operator !== 'empty' && rule.operator !== 'notEmpty') {
        const value = rule.value ?? '';
        if (field.type === 'number' && !Number.isFinite(Number(value))) {
          bad(`条件字段「${field.label}」的比较值必须是数字`);
        }
        if (field.type === 'date' && !DATE_VALUE_PATTERN.test(value)) {
          bad(`条件字段「${field.label}」的比较值必须是日期（YYYY-MM-DD）`);
        }
        if (field.type === 'select' && !(field.options ?? []).includes(value)) {
          bad(`条件字段「${field.label}」的比较值必须是可选选项之一`);
        }
      }
    }
    if (edge.to === WORKFLOW_END_NODE) {
      const canEnd =
        (source.kind === 'acceptance' && edge.outcome === 'approved') ||
        (source.kind === 'approval' &&
          (edge.outcome === 'approved' || edge.outcome === 'rejected')) ||
        (source.kind === 'operation' &&
          (edge.outcome === 'succeeded' || edge.outcome === 'failed')) ||
        (source.kind === 'condition' && !edge.outcome);
      if (!canEnd) {
        bad(
          '只有验收通过、审批通过/驳回、操作节点的成功/失败结果或判断节点的流转可以流转到流程结束',
        );
      }
    }
    const edgeKey =
      source.kind === 'condition'
        ? `${edge.from}\u0000${
            edge.conditions?.length
              ? JSON.stringify(edge.conditions)
              : `__default__:${edge.to}`
          }`
        : `${edge.from}\u0000${edge.outcome ?? '__unconditional__'}`;
    if (edgeKeys.has(edgeKey)) {
      bad(
        source.kind === 'condition'
          ? `判断节点「${source.name}」存在重复的流转条件`
          : edge.outcome
            ? `节点「${edge.from}」的结果「${edge.outcome}」存在重复流转`
            : `节点「${edge.from}」存在重复的无条件流转`,
      );
    }
    edgeKeys.add(edgeKey);
  }

  for (const node of nodes) {
    const outgoing = edges.filter((edge) => edge.from === node.key);
    if (node.kind === 'start') {
      if (strict && outgoing.length !== 1) {
        bad(`起始节点「${node.name}」必须且只能有一条后续流转`);
      }
      if (edges.some((edge) => edge.to === node.key)) {
        bad(`起始节点「${node.name}」不能被其他节点流转进入`);
      }
    }
    if (strict && node.kind !== 'start' && outgoing.length === 0) {
      bad(`节点「${node.name}」没有配置后续流转`);
    }
    if (
      node.kind !== 'condition' &&
      outgoing.length > 1 &&
      outgoing.some((edge) => !edge.outcome)
    ) {
      bad(`节点「${node.name}」存在多条流转时，每条流转都必须指定结果`);
    }
    if (
      strict &&
      (node.kind === 'approval' || node.kind === 'acceptance') &&
      outgoing.some((edge) => !edge.outcome)
    ) {
      bad(`节点「${node.name}」的每条流转都必须指定结果`);
    }
    if (strict && node.kind === 'condition') {
      if (outgoing.length < 2) {
        bad(`判断节点「${node.name}」至少需要两条后续流转`);
      }
      const defaultEdges = outgoing.filter((edge) => !edge.conditions?.length);
      if (defaultEdges.length !== 1) {
        bad(`判断节点「${node.name}」必须且只能配置一条默认（无条件）流转`);
      }
      if (defaultEdges.length === outgoing.length) {
        bad(`判断节点「${node.name}」至少需要一条带条件的流转`);
      }
    }
    if (strict) {
      if (node.kind === 'approval' || node.kind === 'operation') {
        if (!node.taskTemplateId) {
          bad(
            `${node.kind === 'approval' ? '审批' : '操作'}节点「${node.name}」未选择任务定义`,
          );
        }
      }
      if (node.kind === 'approval' && !node.responsibleWorkerId) {
        bad(`审批节点「${node.name}」未选择负责机器人`);
      }
      if (
        (node.kind === 'start' ||
          node.kind === 'acceptance' ||
          node.kind === 'condition') &&
        (node.taskTemplateId || node.responsibleWorkerId)
      ) {
        const kindLabel =
          node.kind === 'start'
            ? '起始'
            : node.kind === 'acceptance'
              ? '验收'
              : '判断';
        bad(`${kindLabel}节点不能配置任务定义或机器人`);
      }
    }
  }

  if (strict) {
    const start = startNodes[0];
    if (
      !acceptanceNodes.some((acceptance) =>
        edges.some(
          (edge) =>
            edge.from === acceptance.key &&
            edge.outcome === 'approved' &&
            edge.to === WORKFLOW_END_NODE,
        ),
      )
    ) {
      bad('至少一个验收节点必须配置「验收通过」流转到流程结束');
    }
    if (
      edges.some(
        (edge) =>
          nodeByKey.get(edge.from)?.kind === 'acceptance' &&
          edge.outcome === 'rejected' &&
          edge.to === WORKFLOW_END_NODE,
      )
    ) {
      bad('验收驳回不能直接结束流程');
    }
    for (const acceptance of acceptanceNodes) {
      if (acceptance.autoAccept) {
        const rejected = edges.find(
          (edge) => edge.from === acceptance.key && edge.outcome === 'rejected',
        );
        if (rejected) {
          bad(`自动验收节点「${acceptance.name}」不能配置「验收驳回」流转`);
        }
      }
    }

    // 从起始节点出发所有节点都可到达
    const reachable = new Set<string>([start.key]);
    const queue = [start.key];
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

    // 每个节点最终都必须能经过验收通过或操作结果到达流程结束
    const canReachEnd = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const node of nodes) {
        if (canReachEnd.has(node.key)) continue;
        const outgoing = edges.filter((edge) => edge.from === node.key);
        const toEnd = outgoing.some(
          (edge) =>
            edge.to === WORKFLOW_END_NODE ||
            (canReachEnd.has(edge.to) && edge.to !== node.key),
        );
        if (toEnd) {
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

  return { startNode: startNodes[0]?.key ?? startNode, nodes, edges };
}

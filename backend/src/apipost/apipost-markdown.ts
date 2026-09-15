/**
 * APIPOST swagger（OpenAPI 3.0 子集）→ Markdown 转换器。
 * 只服务于展示与 AI 阅读：按目录（首个 tag）分组输出接口清单，
 * 参数/请求体/响应解析为表格，$ref 自 components.schemas 展开，嵌套字段拍平为点号路径。
 */

export interface SwaggerSchema {
  type?: string;
  format?: string;
  description?: string;
  enum?: unknown[];
  example?: unknown;
  default?: unknown;
  items?: SwaggerSchema;
  properties?: Record<string, SwaggerSchema>;
  required?: string[];
  $ref?: string;
  allOf?: SwaggerSchema[];
  oneOf?: SwaggerSchema[];
  anyOf?: SwaggerSchema[];
}

export interface SwaggerParameter {
  name: string;
  in: string;
  description?: string;
  required?: boolean;
  example?: unknown;
  schema?: SwaggerSchema;
}

export interface SwaggerMediaType {
  schema?: SwaggerSchema;
  example?: unknown;
}

export interface SwaggerOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  'x-target-id'?: string;
  parameters?: SwaggerParameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, SwaggerMediaType>;
  };
  responses?: Record<
    string,
    { description?: string; content?: Record<string, SwaggerMediaType> }
  >;
}

export interface SwaggerSpec {
  info?: { title?: string; description?: string; version?: string };
  servers?: { url?: string; description?: string }[];
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Record<string, SwaggerOperation>>;
  components?: { schemas?: Record<string, SwaggerSchema> };
}

interface SchemaRow {
  name: string;
  type: string;
  required: boolean;
  example: string;
  description: string;
}

type SchemaMap = Record<string, SwaggerSchema> | undefined;

/** 嵌套字段最大展开层数（根字段为第 1 层），超过后不再下钻，靠类型标注体现 */
const MAX_SCHEMA_DEPTH = 3;
const METHOD_ORDER = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
  'trace',
];

/** 表格单元格转义：竖线与换行 */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function mdText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value.toString();
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '[unserializable]';
  }
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** 解析 $ref（仅支持 #/components/schemas/xxx），无法解析返回 null */
function resolveRef(ref: string, schemas: SchemaMap): SwaggerSchema | null {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
  if (!match || !schemas) return null;
  return schemas[match[1]] ?? null;
}

/** $ref 的展示名（schema 名称） */
function refName(ref: string): string | null {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref);
  return match ? match[1] : null;
}

/** $ref / allOf 归一为实际 schema */
function effective(schema: SwaggerSchema, schemas: SchemaMap): SwaggerSchema {
  const resolved = schema.$ref
    ? (resolveRef(schema.$ref, schemas) ?? schema)
    : schema;
  if (!resolved.allOf?.length) return resolved;
  const merged: SwaggerSchema = { properties: {}, required: [] };
  for (const part of resolved.allOf) {
    const item = part.$ref ? (resolveRef(part.$ref, schemas) ?? part) : part;
    Object.assign(merged.properties!, item.properties ?? {});
    merged.required!.push(...(item.required ?? []));
    if (item.type) merged.type = item.type;
  }
  return merged;
}

/** 类型的展示标注：enum 列出取值、array<T>、number<int64> 等 */
function typeLabel(
  schema: SwaggerSchema | undefined,
  schemas: SchemaMap,
): string {
  if (!schema) return '';
  if (schema.$ref) return refName(schema.$ref) ?? 'object';
  if (schema.enum?.length) {
    const values = schema.enum.slice(0, 5).map((v) => String(v));
    return `enum：${values.join(' | ')}${schema.enum.length > 5 ? ' | …' : ''}`;
  }
  if (schema.allOf?.length) {
    return (
      schema.allOf
        .map((s) => typeLabel(s, schemas))
        .filter(Boolean)
        .join(' & ') || 'object'
    );
  }
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const parts = (schema.oneOf ?? schema.anyOf ?? [])
      .map((s) => typeLabel(s, schemas))
      .filter(Boolean);
    return parts.join(' | ') || 'object';
  }
  switch (schema.type) {
    case 'array':
      return `array<${typeLabel(schema.items, schemas) || 'object'}>`;
    case 'integer':
    case 'number':
      return schema.format ? `${schema.type}<${schema.format}>` : schema.type;
    default:
      return schema.type ?? 'object';
  }
}

/** 该字段是否值得下钻，返回下钻目标 */
function nestedSchema(
  schema: SwaggerSchema,
  schemas: SchemaMap,
): { kind: 'object' | 'array'; schema: SwaggerSchema } | null {
  const source = effective(schema, schemas);
  if (source.type === 'array' && source.items) {
    return { kind: 'array', schema: source.items };
  }
  if (source.properties && Object.keys(source.properties).length > 0) {
    return { kind: 'object', schema: source };
  }
  return null;
}

/** Schema → 扁平字段行；嵌套字段以 player.rank / players[].no 形式命名 */
function schemaToRows(
  schema: SwaggerSchema | undefined,
  schemas: SchemaMap,
  prefix = '',
  depth = 1,
): SchemaRow[] {
  if (!schema) return [];
  const source = effective(schema, schemas);
  const rows: SchemaRow[] = [];
  const required = new Set(source.required ?? []);
  for (const [key, child] of Object.entries(source.properties ?? {})) {
    const name = prefix ? `${prefix}${key}` : key;
    rows.push({
      name,
      type: typeLabel(child, schemas),
      required: required.has(key),
      example: truncate(mdText(child.example ?? child.default)),
      description: mdText(child.description),
    });
    const nested = nestedSchema(child, schemas);
    if (nested && depth < MAX_SCHEMA_DEPTH) {
      const childPrefix = nested.kind === 'array' ? `${name}[].` : `${name}.`;
      rows.push(
        ...schemaToRows(nested.schema, schemas, childPrefix, depth + 1),
      );
    }
  }
  // 根级数组：字段来自 items（如请求体直接是数组）
  if (!prefix && source.type === 'array' && source.items) {
    rows.push(...schemaToRows(source.items, schemas, '', depth + 1));
  }
  return rows;
}

function renderTable(headers: string[], rows: string[][]): string[] {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(' | ')} |`),
  ];
}

const SCHEMA_TABLE_HEADERS = ['字段', '类型', '必填', '示例', '说明'];

function schemaTable(
  schema: SwaggerSchema | undefined,
  schemas: SchemaMap,
): string[] {
  const rows = schemaToRows(schema, schemas);
  if (!rows.length) return [];
  return renderTable(
    SCHEMA_TABLE_HEADERS,
    rows.map((r) => [
      r.name,
      r.type,
      r.required ? '是' : '',
      r.example,
      r.description,
    ]),
  );
}

function parametersLines(op: SwaggerOperation, schemas: SchemaMap): string[] {
  if (!op.parameters?.length) return [];
  return [
    '**请求参数**',
    '',
    ...renderTable(
      ['参数', '位置', '类型', '必填', '示例', '说明'],
      op.parameters.map((p) => [
        p.name,
        p.in,
        p.schema ? typeLabel(p.schema, schemas) : '',
        p.required ? '是' : '',
        truncate(mdText(p.example ?? p.schema?.example ?? p.schema?.default)),
        mdText(p.description ?? p.schema?.description),
      ]),
    ),
  ];
}

function requestBodyLines(op: SwaggerOperation, schemas: SchemaMap): string[] {
  const content = op.requestBody?.content;
  if (!content) return [];
  const lines: string[] = [
    `**请求体**${op.requestBody?.required === false ? '（可选）' : ''}`,
  ];
  let rendered = false;
  for (const [contentType, media] of Object.entries(content)) {
    const table = schemaTable(media.schema, schemas);
    const hasExample = media.example !== undefined && media.example !== '';
    if (!table.length && !hasExample) continue;
    rendered = true;
    lines.push('', `\`${contentType}\``);
    if (table.length) lines.push('', ...table);
    if (hasExample) {
      lines.push(
        '',
        '示例：',
        '',
        '```json',
        safeStringify(media.example),
        '```',
      );
    }
  }
  return rendered ? [...lines, ''] : [];
}

function responseLines(op: SwaggerOperation, schemas: SchemaMap): string[] {
  if (!op.responses) return [];
  const lines: string[] = [];
  for (const [code, resp] of Object.entries(op.responses)) {
    const media =
      resp.content?.['application/json'] ??
      Object.values(resp.content ?? {})[0];
    lines.push('', `**${code} ${mdText(resp.description)}**`.trimEnd());
    if (media) {
      const table = schemaTable(media.schema, schemas);
      if (table.length) lines.push('', ...table);
      if (media.example !== undefined && media.example !== '') {
        lines.push(
          '',
          '示例：',
          '',
          '```json',
          safeStringify(media.example),
          '```',
        );
      }
    }
  }
  return lines.length ? ['**响应**', ...lines, ''] : [];
}

function operationLines(
  method: string,
  path: string,
  op: SwaggerOperation,
  schemas: SchemaMap,
): string[] {
  const heading = [`### ${method.toUpperCase()} ${path}`];
  if (op.summary) heading.push(` — ${op.summary}`);
  if (op.deprecated) heading.push('（已废弃）');
  const lines: string[] = [heading.join(''), ''];
  if (op.description?.trim()) lines.push(op.description.trim(), '');
  const params = parametersLines(op, schemas);
  if (params.length) lines.push(...params, '');
  lines.push(...requestBodyLines(op, schemas));
  lines.push(...responseLines(op, schemas));
  return lines;
}

/** path 下属于操作的 method key，按常用顺序排列 */
function orderedMethods(pathItem: Record<string, SwaggerOperation>): string[] {
  const keys = Object.keys(pathItem);
  return [
    ...METHOD_ORDER.filter((m) => keys.includes(m)),
    ...keys.filter(
      (k) =>
        !METHOD_ORDER.includes(k) &&
        pathItem[k] &&
        typeof pathItem[k] === 'object' &&
        ('responses' in pathItem[k] || 'summary' in pathItem[k]),
    ),
  ];
}

/**
 * swagger → Markdown（不含文档级 H1 标题，由调用方与元信息组合）。
 * 结构：概述（description / Base URL）→ 按首个 tag 分组的 `## 目录` → 每接口 `### METHOD path — summary`。
 */
export function swaggerToMarkdown(spec: SwaggerSpec): string {
  const schemas = spec.components?.schemas;
  const groups = new Map<
    string,
    { method: string; path: string; op: SwaggerOperation }[]
  >();
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of orderedMethods(pathItem)) {
      const op = pathItem[method];
      if (!op || typeof op !== 'object') continue;
      const tag = op.tags?.[0]?.trim() || '未分组';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag)!.push({ method, path, op });
    }
  }
  // 目录顺序：顶层 tags 定义优先，其余按首次出现顺序
  const preferred = (spec.tags ?? []).map((t) => t.name);
  const tagOrder = [
    ...preferred.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !preferred.includes(name)),
  ];

  const lines: string[] = [];
  if (spec.info?.description?.trim()) {
    lines.push(spec.info.description.trim(), '');
  }
  const servers = [
    ...new Set((spec.servers ?? []).map((s) => s.url).filter(Boolean)),
  ];
  if (servers.length) lines.push(`Base URL：${servers.join('、')}`, '');
  for (const tag of tagOrder) {
    lines.push(`## ${tag}`, '');
    for (const { method, path, op } of groups.get(tag)!) {
      lines.push(...operationLines(method, path, op, schemas));
    }
  }
  return lines.join('\n').trimEnd();
}

import { useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@appica/ui-react/badge'
import { Input } from '@appica/ui-react/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@appica/ui-react/table'

/**
 * APIPOST 接口文档展示（swagger/OpenAPI 3.0）：
 * 左栏为按目录（首个 tag）分组的接口列表（方法徽标 + 路径 + 摘要 + 搜索），
 * 右栏为选中接口的详情（参数/请求体/响应 Schema 表格 + 示例 + 查看原文）。
 * 数据源为后端落库的原始 swagger JSON（Document.content），只读，内容变更走「更新同步」。
 */

interface SchemaObject {
  type?: string
  format?: string
  description?: string
  enum?: unknown[]
  example?: unknown
  default?: unknown
  items?: SchemaObject
  properties?: Record<string, SchemaObject>
  required?: string[]
  $ref?: string
  allOf?: SchemaObject[]
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
}

interface Parameter {
  name: string
  in: string
  description?: string
  required?: boolean
  example?: unknown
  schema?: SchemaObject
}

interface MediaType {
  schema?: SchemaObject
  example?: unknown
}

interface Operation {
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  'x-target-id'?: string
  parameters?: Parameter[]
  requestBody?: {
    required?: boolean
    content?: Record<string, MediaType>
  }
  responses?: Record<string, { description?: string; content?: Record<string, MediaType> }>
}

interface SwaggerSpec {
  info?: { title?: string; description?: string }
  servers?: { url?: string }[]
  tags?: { name: string }[]
  paths?: Record<string, Record<string, Operation>>
  components?: { schemas?: Record<string, SchemaObject> }
}

/** 从文档正文解析 swagger JSON；非法内容返回 null（展示层回退提示） */
function parseApipostSpec(content: string | null | undefined): SwaggerSpec | null {
  if (!content) return null
  try {
    const spec = JSON.parse(content) as SwaggerSpec
    return spec && typeof spec === 'object' && spec.paths ? spec : null
  } catch {
    return null
  }
}

interface Endpoint {
  key: string
  method: string
  path: string
  op: Operation
}

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

/** 按首个 tag 分组的接口清单（组间顺序按顶层 tags 定义，组内按 paths 定义顺序） */
function collectEndpoints(spec: SwaggerSpec): { tag: string; endpoints: Endpoint[] }[] {
  const groups = new Map<string, Endpoint[]>()
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue
    const methods = [
      ...METHOD_ORDER.filter((m) => pathItem[m]),
      ...Object.keys(pathItem).filter((m) => !METHOD_ORDER.includes(m)),
    ]
    for (const method of methods) {
      const op = pathItem[method]
      if (!op || typeof op !== 'object') continue
      const tag = op.tags?.[0]?.trim() || '未分组'
      if (!groups.has(tag)) groups.set(tag, [])
      groups.get(tag)!.push({ key: `${method.toUpperCase()} ${path}`, method, path, op })
    }
  }
  const preferred = (spec.tags ?? []).map((t) => t.name)
  const tagOrder = [
    ...preferred.filter((name) => groups.has(name)),
    ...[...groups.keys()].filter((name) => !preferred.includes(name)),
  ]
  return tagOrder.map((tag) => ({ tag, endpoints: groups.get(tag)! }))
}

const METHOD_VARIANTS: Record<string, 'success' | 'primary' | 'warning' | 'info' | 'error' | 'secondary'> = {
  get: 'success',
  post: 'primary',
  put: 'warning',
  patch: 'info',
  delete: 'error',
}

function MethodBadge({ method }: { method: string }) {
  return (
    <Badge variant={METHOD_VARIANTS[method] ?? 'secondary'} size="sm">
      {method.toUpperCase()}
    </Badge>
  )
}

// ---- Schema 解析（与后端 apipost-markdown.ts 同构：$ref 展开 + 嵌套拍平） ----

type SchemaMap = Record<string, SchemaObject> | undefined
const MAX_SCHEMA_DEPTH = 3

interface SchemaRow {
  name: string
  type: string
  required: boolean
  example: string
  description: string
}

function resolveRef(ref: string, schemas: SchemaMap): SchemaObject | null {
  const match = /^#\/components\/schemas\/(.+)$/.exec(ref)
  return match && schemas ? (schemas[match[1]] ?? null) : null
}

function effective(schema: SchemaObject, schemas: SchemaMap): SchemaObject {
  const resolved = schema.$ref ? (resolveRef(schema.$ref, schemas) ?? schema) : schema
  if (!resolved.allOf?.length) return resolved
  const merged: SchemaObject = { properties: {}, required: [] }
  for (const part of resolved.allOf) {
    const item = part.$ref ? (resolveRef(part.$ref, schemas) ?? part) : part
    Object.assign(merged.properties!, item.properties ?? {})
    merged.required!.push(...(item.required ?? []))
    if (item.type) merged.type = item.type
  }
  return merged
}

function typeLabel(schema: SchemaObject | undefined): string {
  if (!schema) return ''
  if (schema.$ref) {
    const name = /^#\/components\/schemas\/(.+)$/.exec(schema.$ref)?.[1]
    return name ?? 'object'
  }
  if (schema.enum?.length) {
    const values = schema.enum.slice(0, 5).map((v) => String(v))
    return `enum：${values.join(' | ')}${schema.enum.length > 5 ? ' | …' : ''}`
  }
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const parts = (schema.oneOf ?? schema.anyOf ?? [])
      .map((s) => typeLabel(s))
      .filter(Boolean)
    return parts.join(' | ') || 'object'
  }
  switch (schema.type) {
    case 'array':
      return `array<${typeLabel(schema.items) || 'object'}>`
    case 'integer':
    case 'number':
      return schema.format ? `${schema.type}<${schema.format}>` : schema.type
    default:
      return schema.type ?? 'object'
  }
}

function schemaRows(
  schema: SchemaObject | undefined,
  schemas: SchemaMap,
  prefix = '',
  depth = 1,
): SchemaRow[] {
  if (!schema) return []
  const source = effective(schema, schemas)
  const rows: SchemaRow[] = []
  const required = new Set(source.required ?? [])
  for (const [key, child] of Object.entries(source.properties ?? {})) {
    const name = prefix ? `${prefix}${key}` : key
    rows.push({
      name,
      type: typeLabel(child),
      required: required.has(key),
      example: stringifyExample(child.example ?? child.default),
      description: text(child.description),
    })
    const resolved = effective(child, schemas)
    if (depth < MAX_SCHEMA_DEPTH) {
      if (resolved.type === 'array' && resolved.items) {
        rows.push(...schemaRows(resolved.items, schemas, `${name}[].`, depth + 1))
      } else if (resolved.properties && Object.keys(resolved.properties).length > 0) {
        rows.push(...schemaRows(resolved, schemas, `${name}.`, depth + 1))
      }
    }
  }
  if (!prefix && source.type === 'array' && source.items) {
    rows.push(...schemaRows(source.items, schemas, '', depth + 1))
  }
  return rows
}

function text(value: unknown): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

function stringifyExample(value: unknown): string {
  const s = text(value)
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

function hasContent(media: MediaType | undefined, schemas: SchemaMap): boolean {
  if (!media) return false
  const rows = schemaRows(media.schema, schemas)
  return rows.length > 0 || (media.example !== undefined && media.example !== '')
}

// ---- 展示组件 ----

function SchemaTable({ schema, schemas }: { schema: SchemaObject | undefined; schemas: SchemaMap }) {
  const rows = schemaRows(schema, schemas)
  if (rows.length === 0) return null
  return (
    <Table size="sm">
      <TableHeader>
        <TableRow>
          <TableHead>字段</TableHead>
          <TableHead className="w-32">类型</TableHead>
          <TableHead className="w-14 text-center">必填</TableHead>
          <TableHead className="w-40">示例</TableHead>
          <TableHead>说明</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.name}>
            <TableCell className="font-mono text-xs">{row.name}</TableCell>
            <TableCell className="text-xs break-all">{row.type}</TableCell>
            <TableCell className="text-center text-xs">{row.required ? '是' : ''}</TableCell>
            <TableCell className="font-mono text-xs break-all">{row.example}</TableCell>
            <TableCell className="text-xs">{row.description}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function ExampleBlock({ value }: { value: unknown }) {
  if (value === undefined || value === null || value === '') return null
  return (
    <pre className="overflow-auto rounded-md border border-border-strong bg-background-muted p-3 font-mono text-xs">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold">{children}</h3>
}

/** 单个接口详情 */
function EndpointDetail({
  endpoint,
  schemas,
  docsUrl,
}: {
  endpoint: Endpoint
  schemas: SchemaMap
  docsUrl: string | null
}) {
  const { op } = endpoint
  const originalUrl =
    docsUrl && op['x-target-id']
      ? `${docsUrl}?target_id=${op['x-target-id']}&locale=zh-cn`
      : docsUrl
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{op.summary ?? endpoint.path}</h2>
          {op.deprecated && <Badge variant="outline">已废弃</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MethodBadge method={endpoint.method} />
          <code className="rounded-sm bg-background-muted px-1.5 py-0.5 font-mono text-xs">
            {endpoint.path}
          </code>
          {originalUrl && (
            <a
              href={originalUrl}
              target="_blank"
              rel="noreferrer"
              className="text-foreground-intense text-sm underline"
            >
              查看原文
            </a>
          )}
        </div>
        {op.description?.trim() && (
          <p className="text-sm whitespace-pre-wrap text-foreground-muted">{op.description.trim()}</p>
        )}
      </div>

      {op.parameters && op.parameters.length > 0 && (
        <section>
          <SectionTitle>请求参数</SectionTitle>
          <Table size="sm">
            <TableHeader>
              <TableRow>
                <TableHead>参数</TableHead>
                <TableHead className="w-20">位置</TableHead>
                <TableHead className="w-32">类型</TableHead>
                <TableHead className="w-14 text-center">必填</TableHead>
                <TableHead className="w-40">示例</TableHead>
                <TableHead>说明</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {op.parameters.map((p) => (
                <TableRow key={`${p.in}-${p.name}`}>
                  <TableCell className="font-mono text-xs">{p.name}</TableCell>
                  <TableCell className="text-xs">{p.in}</TableCell>
                  <TableCell className="text-xs break-all">
                    {typeLabel(p.schema)}
                  </TableCell>
                  <TableCell className="text-center text-xs">{p.required ? '是' : ''}</TableCell>
                  <TableCell className="font-mono text-xs break-all">
                    {stringifyExample(p.example ?? p.schema?.example ?? p.schema?.default)}
                  </TableCell>
                  <TableCell className="text-xs">{text(p.description ?? p.schema?.description)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {op.requestBody?.content &&
        Object.entries(op.requestBody.content).some(([, m]) => hasContent(m, schemas)) && (
          <section>
            <SectionTitle>请求体{op.requestBody.required === false ? '（可选）' : ''}</SectionTitle>
            <div className="flex flex-col gap-3">
              {Object.entries(op.requestBody.content)
                .filter(([, m]) => hasContent(m, schemas))
                .map(([contentType, media]) => (
                  <div key={contentType} className="flex flex-col gap-2">
                    <code className="font-mono text-xs text-foreground-muted">{contentType}</code>
                    <SchemaTable schema={media.schema} schemas={schemas} />
                    <ExampleBlock value={media.example} />
                  </div>
                ))}
            </div>
          </section>
        )}

      {op.responses && Object.keys(op.responses).length > 0 && (
        <section>
          <SectionTitle>响应</SectionTitle>
          <div className="flex flex-col gap-3">
            {Object.entries(op.responses).map(([code, resp]) => {
              const media =
                resp.content?.['application/json'] ??
                Object.values(resp.content ?? {})[0]
              return (
                <div key={code} className="flex flex-col gap-2">
                  <p className="text-sm">
                    <span className="font-mono font-semibold">{code}</span>
                    {resp.description ? ` ${resp.description}` : ''}
                  </p>
                  <SchemaTable schema={media?.schema} schemas={schemas} />
                  <ExampleBlock value={media?.example} />
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

/** APIPOST 接口文档左右分栏视图（content 为后端落库的原始 swagger JSON） */
export function ApipostDocViewer({
  content,
  docsUrl,
}: {
  content: string | null | undefined
  docsUrl: string | null
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [keyword, setKeyword] = useState('')

  const spec = useMemo(() => parseApipostSpec(content), [content])
  const schemas = spec?.components?.schemas
  const groups = useMemo(() => (spec ? collectEndpoints(spec) : []), [spec])
  const q = keyword.trim().toLowerCase()
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          tag: g.tag,
          endpoints: q
            ? g.endpoints.filter(
                (ep) =>
                  ep.path.toLowerCase().includes(q) ||
                  (ep.op.summary ?? '').toLowerCase().includes(q),
              )
            : g.endpoints,
        }))
        .filter((g) => g.endpoints.length > 0),
    [groups, q],
  )
  const selected =
    groups.flatMap((g) => g.endpoints).find((ep) => ep.key === selectedKey) ??
    groups[0]?.endpoints[0]

  if (!spec) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-border-strong bg-background">
        <p className="text-sm text-foreground-muted">
          swagger 内容解析失败，请尝试「更新同步」重新拉取
        </p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* 左栏：接口目录 */}
      <aside className="flex w-72 shrink-0 flex-col gap-2 rounded-md border border-border-strong bg-background">
        <div className="p-2 pb-0">
          <Input
            placeholder="搜索路径 / 摘要…"
            clearable
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onClear={() => setKeyword('')}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 pt-0">
          {visibleGroups.map((g) => (
            <div key={g.tag} className="mb-2">
              <p className="truncate px-1 py-1 text-xs font-medium text-foreground-muted" title={g.tag}>
                {g.tag}
              </p>
              {g.endpoints.map((ep) => (
                <button
                  key={ep.key}
                  type="button"
                  onClick={() => setSelectedKey(ep.key)}
                  className={`flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-xs ${
                    selected?.key === ep.key ? 'bg-background-muted font-medium' : 'hover:bg-background-muted'
                  }`}
                  title={`${ep.key}${ep.op.summary ? ` — ${ep.op.summary}` : ''}`}
                >
                  <MethodBadge method={ep.method} />
                  <span className="truncate font-mono">{ep.op.summary ?? ep.path}</span>
                </button>
              ))}
            </div>
          ))}
          {visibleGroups.length === 0 && (
            <p className="px-1 py-2 text-sm text-foreground-muted">无匹配接口</p>
          )}
        </div>
      </aside>

      {/* 右栏：接口详情 */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border-strong bg-background p-4">
        {selected ? (
          <EndpointDetail endpoint={selected} schemas={schemas} docsUrl={docsUrl} />
        ) : (
          <p className="text-sm text-foreground-muted">该文档未包含接口定义</p>
        )}
      </div>
    </div>
  )
}

/** 与后端 common/enums.ts 对应，枚举值用中文原文 */
export const PROJECT_TYPES = ['活动', '功能', '游戏', '数据', '后台', '技术', '其它'] as const
export type ProjectType = (typeof PROJECT_TYPES)[number]

export const PROJECT_STATUSES = ['计划中', '进行中', '已结束'] as const
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]

/** 与后端 DocumentType 对应 */
export const DOCUMENT_TYPES = [
  '需求',
  '功能',
  '测试',
  '技术',
  '接口',
  '配置',
] as const
export type DocumentType = (typeof DOCUMENT_TYPES)[number]

export interface ProjectDocument {
  id: number
  title: string
  type: string
  source: string
  feishuUrl: string | null
  description: string | null
  remark: string | null
  content?: string | null
  projectId?: number
  updatedAt: string
}

/** 检查：本质是一个脚本，登记其元信息（编号/描述/脚本位置） */
export interface ProjectCheck {
  id: number
  /** 编号（手工定义，项目内唯一） */
  code: string
  /** 描述：脚本检查的内容 */
  description: string | null
  /** 脚本位置：相对脚本根目录的 .check.ts 路径 */
  scriptPath: string
  projectId?: number
  updatedAt: string
}

/** 脚本输出协议中的单条 act/check 记录 */
export interface CheckRunItem {
  kind: 'act' | 'check'
  no?: number
  title?: string
  status?: 'success' | 'fail' | 'skip'
  expect?: string
  real?: string
  message?: string
  time?: number
}

/** 一次脚本运行记录：running 期间实时更新 current/total，结束后落完整结果 */
export interface CheckRun {
  id: number
  checkId: number
  /** running=执行中；success=全部通过；fail=有失败项；error=脚本异常 */
  status: 'running' | 'success' | 'fail' | 'error'
  /** 总步数（脚本 [start] 上报） */
  total: number | null
  /** 当前步数（运行中实时更新） */
  current: number
  success: number | null
  fail: number | null
  skip: number | null
  message: string | null
  /** 耗时（毫秒），结束时写入 */
  durationMs: number | null
  /** 逐项明细（结束时写入） */
  items: CheckRunItem[] | null
  /** 日志行（结束时写入） */
  logs: string[] | null
  /** 脚本原始输出行（终端展示用；运行中实时累积） */
  output: string[] | null
  startedAt: string
  finishedAt: string | null
}

/** 测试：本质是一个脚本，登记其元信息（编号/描述/脚本位置），同检查但脚本后缀为 .test.ts */
export interface ProjectTest {
  id: number
  /** 编号（手工定义，项目内唯一） */
  code: string
  /** 描述：脚本测试的内容 */
  description: string | null
  /** 脚本位置：相对脚本根目录的 .test.ts 路径 */
  scriptPath: string
  projectId?: number
  updatedAt: string
}

/** 测试的一次脚本运行记录（字段与检查运行相同，脚本输出协议一致） */
export interface TestRun {
  id: number
  testId: number
  /** running=执行中；success=全部通过；fail=有失败项；error=脚本异常 */
  status: 'running' | 'success' | 'fail' | 'error'
  /** 总步数（脚本 [start] 上报） */
  total: number | null
  /** 当前步数（运行中实时更新） */
  current: number
  success: number | null
  fail: number | null
  skip: number | null
  message: string | null
  /** 耗时（毫秒），结束时写入 */
  durationMs: number | null
  /** 逐项明细（结束时写入） */
  items: CheckRunItem[] | null
  /** 日志行（结束时写入） */
  logs: string[] | null
  /** 脚本原始输出行（终端展示用；运行中实时累积） */
  output: string[] | null
  startedAt: string
  finishedAt: string | null
}

export interface Project {
  id: number
  name: string
  type: ProjectType
  status: ProjectStatus
  expectedReleaseAt: string | null
  iterationCycle: string | null
  priority: string | null
  resources: { frontend?: string; backend?: string; qa?: string } | null
  /** 飞书同步的项目有 record_id，可据此判断来源 */
  feishuRecordId: string | null
  description: string | null
  /** 脚本目录：相对脚本根目录的路径，登记检查时只在该子目录下扫描 */
  scriptsPath: string | null
  documents?: ProjectDocument[]
  checks?: ProjectCheck[]
  tests?: ProjectTest[]
  createdAt: string
  updatedAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.message ?? `请求失败 (${res.status})`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export const api = {
  listProjects: () => request<Project[]>('/projects'),
  getProject: (id: number) => request<Project>(`/projects/${id}`),
  createProject: (input: {
    name: string
    type?: ProjectType
    expectedReleaseAt?: string
    description?: string
  }) => request<Project>('/projects', { method: 'POST', body: JSON.stringify(input) }),
  deleteProject: (id: number) =>
    request<void>(`/projects/${id}`, { method: 'DELETE' }),
  updateProject: (id: number, input: { scriptsPath?: string }) =>
    request<Project>(`/projects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  syncProjectsFromFeishu: () =>
    request<{
      since: string
      firstSync: boolean
      scanned: number
      synced: number
    }>('/projects/sync-feishu', { method: 'POST' }),
  createDocument: (input: {
    projectId: number
    title: string
    type: DocumentType
    content?: string
  }) =>
    request<ProjectDocument>('/documents', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  importFeishuDocument: (input: {
    projectId: number
    type: DocumentType
    url: string
    description?: string
  }) =>
    request<ProjectDocument>('/documents/sync-feishu', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateDocumentRemark: (id: number, remark: string) =>
    request<ProjectDocument>(`/documents/${id}/remark`, {
      method: 'PATCH',
      body: JSON.stringify({ remark }),
    }),
  getDocument: (id: number) => request<ProjectDocument>(`/documents/${id}`),
  updateDocumentContent: (id: number, content: string) =>
    request<ProjectDocument>(`/documents/${id}/content`, {
      method: 'PATCH',
      body: JSON.stringify({ content }),
    }),
  deleteDocument: (id: number) =>
    request<void>(`/documents/${id}`, { method: 'DELETE' }),
  /** 脚本自动联想：扫描 .check.ts 文件；传 projectId 时限定在项目的脚本目录下 */
  listCheckScripts: (keyword?: string, projectId?: number) => {
    const params = new URLSearchParams()
    if (keyword) params.set('q', keyword)
    if (projectId !== undefined) params.set('projectId', String(projectId))
    const qs = params.toString()
    return request<string[]>(`/checks/scripts${qs ? `?${qs}` : ''}`)
  },
  createCheck: (input: {
    projectId: number
    code: string
    description?: string
    scriptPath: string
  }) =>
    request<ProjectCheck>('/checks', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCheck: (
    id: number,
    input: Partial<{ code: string; description: string; scriptPath: string }>,
  ) =>
    request<ProjectCheck>(`/checks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteCheck: (id: number) =>
    request<void>(`/checks/${id}`, { method: 'DELETE' }),
  /** 自动导入：扫描项目脚本目录下所有 .check.ts，过滤已登记的，其余全部导入 */
  importChecks: (projectId: number) =>
    request<{ created: ProjectCheck[]; skipped: number }>('/checks/import', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getCheck: (id: number) => request<ProjectCheck>(`/checks/${id}`),
  /** 启动一次脚本运行：立即返回 running 记录，脚本后台异步执行 */
  startCheckRun: (checkId: number) =>
    request<CheckRun>(`/checks/${checkId}/runs`, { method: 'POST' }),
  /** 运行历史（倒序，上限 50） */
  listCheckRuns: (checkId: number) =>
    request<CheckRun[]>(`/checks/${checkId}/runs`),
  /** 单次运行详情（含实时进度，运行中轮询） */
  getCheckRun: (runId: number) => request<CheckRun>(`/checks/runs/${runId}`),
  /** 测试脚本自动联想：扫描 .test.ts 文件；传 projectId 时限定在项目的脚本目录下 */
  listTestScripts: (keyword?: string, projectId?: number) => {
    const params = new URLSearchParams()
    if (keyword) params.set('q', keyword)
    if (projectId !== undefined) params.set('projectId', String(projectId))
    const qs = params.toString()
    return request<string[]>(`/tests/scripts${qs ? `?${qs}` : ''}`)
  },
  createTest: (input: {
    projectId: number
    code: string
    description?: string
    scriptPath: string
  }) =>
    request<ProjectTest>('/tests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTest: (
    id: number,
    input: Partial<{ code: string; description: string; scriptPath: string }>,
  ) =>
    request<ProjectTest>(`/tests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTest: (id: number) =>
    request<void>(`/tests/${id}`, { method: 'DELETE' }),
  /** 自动导入：扫描项目脚本目录下所有 .test.ts，过滤已登记的，其余全部导入 */
  importTests: (projectId: number) =>
    request<{ created: ProjectTest[]; skipped: number }>('/tests/import', {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  getTest: (id: number) => request<ProjectTest>(`/tests/${id}`),
  /** 启动一次测试脚本运行：立即返回 running 记录，脚本后台异步执行 */
  startTestRun: (testId: number) =>
    request<TestRun>(`/tests/${testId}/runs`, { method: 'POST' }),
  /** 测试运行历史（倒序，上限 50） */
  listTestRuns: (testId: number) =>
    request<TestRun[]>(`/tests/${testId}/runs`),
  /** 单次测试运行详情（含实时进度，运行中轮询） */
  getTestRun: (runId: number) => request<TestRun>(`/tests/runs/${runId}`),
}

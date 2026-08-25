import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@appica/ui-react/table'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogClose,
} from '@appica/ui-react/dialog'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogClose,
} from '@appica/ui-react/alert-dialog'
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteItem,
} from '@appica/ui-react/autocomplete'
import { Button, buttonVariants } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Textarea } from '@appica/ui-react/textarea'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import { Badge } from '@appica/ui-react/badge'
import { Switch } from '@appica/ui-react/switch'
import {
  api,
  APP_PLATFORMS,
  APP_TARGETS,
  DOCUMENT_TYPES,
  type AppVersion,
  type Defect,
  type DocumentType,
  type Project,
  type ProjectCheck,
  type ProjectDocument,
  type ProjectTask,
  type ProjectTest,
} from '../lib/api'
import { DefectStatusBadge, StatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { RunStats } from '../components/RunStats'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [project, setProject] = useState<Project | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!id) return
    api
      .getProject(Number(id))
      .then(setProject)
      .catch((e: Error) => setError(e.message))
  }, [id])

  useEffect(reload, [reload])

  if (error) return <p>加载失败:{error}</p>
  if (!project) return <p>加载中…</p>

  return (
    <div className="flex gap-6">
      {/* 左侧：内容区，从上到下平铺 */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[{ label: '项目', to: '/projects' }, { label: project.name }]}
        />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">文档</h2>
            <div className="flex gap-2">
              <Link
                to={`/documents?projectId=${project.id}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                查看全部
              </Link>
              <CreateDocumentDialog projectId={project.id} onCreated={reload} />
              <ImportDocumentDialog projectId={project.id} onImported={reload} />
            </div>
          </div>
          <DocumentsPanel project={project} onChanged={reload} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">检查</h2>
            <div className="flex items-center gap-2">
              <Link
                to={`/checks?projectId=${project.id}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                查看全部
              </Link>
              <ImportChecksButton projectId={project.id} scriptsPath={project.scriptsPath ?? null} onImported={reload} />
              <CheckFormDialog projectId={project.id} onSaved={reload} />
            </div>
          </div>
          <ChecksPanel project={project} onChanged={reload} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">测试</h2>
            <div className="flex items-center gap-2">
              <Link
                to={`/tests?projectId=${project.id}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                查看全部
              </Link>
              <ImportTestsButton projectId={project.id} scriptsPath={project.scriptsPath ?? null} onImported={reload} />
              <TestFormDialog projectId={project.id} onSaved={reload} />
            </div>
          </div>
          <TestsPanel project={project} onChanged={reload} />
        </section>

        <section>
          <AppVersionsPanel project={project} onChanged={reload} />
        </section>

        <section>
          <DefectsPanel project={project} onChanged={reload} />
        </section>

        <section>
          <TasksSection project={project} />
        </section>
      </div>

      {/* 右侧：项目详情 */}
      <aside className="w-80 shrink-0">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between gap-2">
              <span className="truncate">{project.name}</span>
              {/* Markdown 视图：后端 .md URL 规范（GET /api/projects/:id.md） */}
              <a
                href={`/api/projects/${project.id}.md`}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-sm font-normal underline"
                title="Markdown 视图"
              >
                MD
              </a>
            </CardTitle>
            <CardDescription>{project.description ?? '暂无描述'}</CardDescription>
          </CardHeader>
          <dl className="flex flex-col gap-3 px-6 pb-6 text-sm">
            <div className="flex justify-between">
              <dt>类型</dt>
              <dd>
                <Badge variant="secondary">{project.type}</Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>状态</dt>
              <dd>
                <StatusBadge status={project.status} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>预期发布</dt>
              <dd>{project.expectedReleaseAt ?? '未定'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>迭代</dt>
              <dd>{project.iterationCycle ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>优先级</dt>
              <dd>{project.priority ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>来源</dt>
              <dd>{project.feishuRecordId ? '飞书同步' : '手动创建'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>脚本目录</dt>
              <dd className="flex items-center gap-1">
                <span className="max-w-40 truncate" title={project.scriptsPath ?? ''}>
                  {project.scriptsPath ?? '—'}
                </span>
                <EditScriptsPathDialog project={project} onSaved={reload} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>飞书通知群</dt>
              <dd className="flex items-center gap-1">
                <span className="max-w-40 truncate" title={project.feishuWebhook ?? ''}>
                  {project.feishuWebhook ?? '—'}
                </span>
                <EditWebhookDialog project={project} onSaved={reload} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>缺陷表格</dt>
              <dd className="flex items-center gap-1">
                {project.defectBitableUrl ? (
                  <a
                    href={project.defectBitableUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="max-w-40 truncate underline"
                    title={project.defectBitableUrl}
                  >
                    飞书多维表格
                  </a>
                ) : (
                  <span>—</span>
                )}
                <EditDefectBitableDialog project={project} onSaved={reload} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>资源</dt>
              <dd>—</dd>
            </div>
            <div className="flex justify-between pl-3">
              <dt>前端</dt>
              <dd>{project.resources?.frontend ?? '—'}</dd>
            </div>
            <div className="flex justify-between pl-3">
              <dt>后端</dt>
              <dd>{project.resources?.backend ?? '—'}</dd>
            </div>
            <div className="flex justify-between pl-3">
              <dt>测试</dt>
              <dd>{project.resources?.qa ?? '—'}</dd>
            </div>
          </dl>
        </Card>
      </aside>
    </div>
  )
}

/** 栏目计数行：放在表格 TableBody 末尾，跨整行右对齐展示「总共 x 条，展示 y 条」；无数据时不渲染 */
function CountRow({
  colSpan,
  total,
  displayed,
}: {
  colSpan: number
  total: number
  displayed: number
}) {
  if (total === 0) return null
  return (
    <TableRow>
      <TableCell
        colSpan={colSpan}
        className="text-right text-xs text-foreground-muted"
      >
        总共 {total} 条，展示 {displayed} 条
      </TableCell>
    </TableRow>
  )
}

/**
 * 快速筛选胶囊：未选中=对应语义浅色（warning/success-muted 深色字），选中=该色 intense 深色背景 + 浅色字。
 * 颜色用 Appica 语义角色 token（非 hue 字面量），圆角沿用 Badge 的 rounded-full。
 */
function FilterPill({
  label,
  tone,
  active,
  onClick,
}: {
  label: string
  tone: 'warning' | 'success'
  active: boolean
  onClick: () => void
}) {
  const tones = {
    warning: active
      ? 'bg-warning-intense text-foreground-inverse'
      : 'bg-warning-muted text-warning-foreground',
    success: active
      ? 'bg-success-intense text-foreground-inverse'
      : 'bg-success-muted text-success-foreground',
  }[tone]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-5 cursor-pointer items-center rounded-full px-2 text-xs transition-colors ${tones}`}
    >
      {label}
    </button>
  )
}
function ChecksPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const allChecks = project.checks ?? []
  const checks = allChecks.slice(0, 10)
  const [error, setError] = useState<string | null>(null)
  // 脚本路径显示时去掉与项目脚本目录重叠的前缀（tooltip 仍展示完整路径）
  const dirPrefix = project.scriptsPath
    ? `${project.scriptsPath.replace(/\/+$/, '')}/`
    : ''
  const displayScriptPath = (p: string) =>
    dirPrefix && p.startsWith(dirPrefix) ? p.slice(dirPrefix.length) : p
  return (
    <>
      {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">编号</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checks.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link
                  to={`/projects/${project.id}/checks/${c.id}`}
                  className="underline"
                >
                  {c.code}
                </Link>
              </TableCell>
              <TableCell className="max-w-md truncate" title={c.scriptPath}>
                {displayScriptPath(c.scriptPath)}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <RunCheckButton check={c} projectId={project.id} />
                  <CheckFormDialog
                    projectId={project.id}
                    check={c}
                    onSaved={onChanged}
                  />
                  <DeleteCheckButton
                    check={c}
                    onDeleted={() =>
                      api
                        .deleteCheck(c.id)
                        .then(onChanged)
                        .catch((e: Error) => setError(e.message))
                    }
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {checks.length === 0 && (
            <TableRow>
              <TableCell colSpan={3}>暂无检查</TableCell>
            </TableRow>
          )}
          <CountRow
            colSpan={3}
            total={allChecks.length}
            displayed={checks.length}
          />
        </TableBody>
      </Table>
    </>
  )
}

/** 新建/编辑检查：脚本位置支持从 .check.ts 文件中自动联想、搜索 */
function CheckFormDialog({
  projectId,
  check,
  onSaved,
}: {
  projectId: number
  /** 传入则为编辑，否则为新建 */
  check?: ProjectCheck
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [scriptPath, setScriptPath] = useState('')
  const [scripts, setScripts] = useState<string[]>([])
  // 运行设备：server/h5 本地直跑；android/ios 走 appium-agent 远程
  const [device, setDevice] = useState<string>('server')
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单，并拉取脚本文件列表供自动联想
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setCode(check?.code ?? '')
      setDescription(check?.description ?? '')
      setScriptPath(check?.scriptPath ?? '')
      setDevice(check?.device ?? 'server')
      setError(null)
      api
        .listCheckScripts(undefined, projectId)
        .then(setScripts)
        .catch(() => setScripts([]))
    }
  }

  const submit = () => {
    setError(null)
    const saving = check
      ? api.updateCheck(check.id, { code, description, scriptPath, device })
      : api.createCheck({
          projectId,
          code,
          description: description || undefined,
          scriptPath,
          device,
        })
    saving
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        {check ? (
          <Button variant="outline" size="sm">
            编辑
          </Button>
        ) : (
          <Button variant="outline" size="sm">添加检查</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{check ? '编辑检查' : '添加检查'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              编号（手工定义，项目内唯一）
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 CHECK-001"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              描述（脚本检查的内容）
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个脚本检查什么…"
                rows={3}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              脚本（输入关键字自动联想 .check.ts 文件）
              <Autocomplete
                items={scripts}
                value={scriptPath}
                onValueChange={(v) => setScriptPath(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="如 projects/active/pk/checks/xxx.check.ts"
                  aria-label="脚本"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的脚本</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => (
                      <AutocompleteItem key={item} value={item}>
                        {item}
                      </AutocompleteItem>
                    )}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              运行设备（server/h5 本地直跑；android/ios 走 appium-agent 远程）
              <Select
                value={device}
                onValueChange={(v) => setDevice(v as string)}
                items={{
                  server: 'server（后端/服务端）',
                  h5: 'h5（前端页面）',
                  android: 'Android（appium）',
                  ios: 'iOS（appium）',
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="server">
                    server（后端/服务端）
                  </SelectItem>
                  <SelectItem value="h5">h5（前端页面）</SelectItem>
                  <SelectItem value="android">Android（appium）</SelectItem>
                  <SelectItem value="ios">iOS（appium）</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!code.trim() || !scriptPath.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 自动导入检查：扫描项目脚本目录下全部 .check.ts，过滤已登记的全部导入 */
function ImportChecksButton(
{
  projectId,
  scriptsPath,
  onImported,
}: {
  projectId: number
  scriptsPath: string | null
  onImported: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = () => {
    if (!scriptsPath) {
      setMessage('请先在右侧设置项目的脚本目录，再执行自动导入')
      return
    }
    setLoading(true)
    setMessage(null)
    api
      .importChecks(projectId)
      .then((r) => {
        setMessage(`已导入 ${r.created.length} 个，跳过 ${r.skipped} 个`)
        onImported()
      })
      .catch((e: Error) => setMessage(`导入失败:${e.message}`))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={loading}
        title="扫描脚本目录下的 .check.ts，未登记的全部导入（编号按文件名生成，描述待补充）"
      >
        {loading ? '导入中…' : '自动导入'}
      </Button>
      {message && <span className="text-sm text-foreground-muted">{message}</span>}
    </>
  )
}

/** 运行检查脚本：启动一次运行并跳转到运行详情页（实时进度/历史记录） */
function RunCheckButton({
  check,
  projectId,
}: {
  check: ProjectCheck
  projectId: number
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    setLoading(true)
    setError(null)
    api
      .startCheckRun(check.id)
      .then(() => navigate(`/projects/${projectId}/checks/${check.id}`))
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={loading}
      title={error ?? '启动一次脚本运行'}
    >
      {loading ? '启动中…' : '运行'}
    </Button>
  )
}

function DeleteCheckButton({
  check,
  onDeleted,
}: {
  check: ProjectCheck
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除检查</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除检查「{check.code}」吗？只删除登记信息，不影响脚本文件本身。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" onClick={onDeleted}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 设置项目的脚本目录（相对脚本根目录），登记检查时只在该子目录下联想 .check.ts */
function EditScriptsPathDialog({
  project,
  onSaved,
}: {
  project: Project
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [scriptsPath, setScriptsPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setScriptsPath(project.scriptsPath ?? '')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateProject(project.id, { scriptsPath })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="sm">
          设置
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置脚本目录</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              脚本目录（相对脚本根目录，留空则扫描整个根目录）
              <Input
                value={scriptsPath}
                onChange={(e) => setScriptsPath(e.target.value)}
                placeholder="如 projects/active/pk"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 设置项目的飞书通知群：群机器人 webhook 的 secret，任务运行时向该群推送开始/结果通知 */
function EditWebhookDialog({
  project,
  onSaved,
}: {
  project: Project
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [webhook, setWebhook] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setWebhook(project.feishuWebhook ?? '')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateProject(project.id, { feishuWebhook: webhook })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="sm">
          设置
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置飞书通知群</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              群机器人 webhook 的 secret（hook 地址最后一段，留空则走平台默认群）
              <Input
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="如 e09e9672-1f50-4b65-a181-8750bae489fc"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DocumentsPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const allDocuments = project.documents ?? []
  const documents = allDocuments.slice(0, 10)
  return (
    <>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>标题</TableHead>
          <TableHead>类型</TableHead>
          <TableHead>描述</TableHead>
          <TableHead>来源</TableHead>
          <TableHead className="w-40 text-center">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((d) => (
          <TableRow key={d.id}>
            <TableCell className="max-w-md truncate" title={d.title}>
              <Link to={`/documents/${d.id}`} className="underline">
                {d.title}
              </Link>
            </TableCell>
            <TableCell>{d.type}</TableCell>
            <TableCell className="max-w-48 truncate" title={d.description ?? ''}>
              {d.description ?? '—'}
            </TableCell>
            <TableCell>
              {d.feishuUrl ? (
                <a
                  href={d.feishuUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {d.source}
                </a>
              ) : (
                d.source
              )}
            </TableCell>
            <TableCell className="text-center">
              {d.source === '飞书' && (
                <ResyncDocumentButton
                  document={d}
                  projectId={project.id}
                  onSynced={onChanged}
                />
              )}
            </TableCell>
          </TableRow>
        ))}
        {documents.length === 0 && (
          <TableRow>
            <TableCell colSpan={5}>暂无文档</TableCell>
          </TableRow>
        )}
        <CountRow
          colSpan={5}
          total={allDocuments.length}
          displayed={documents.length}
        />
        </TableBody>
      </Table>
    </>
  )
}


/** 更新同步：按原始链接重新从飞书拉取（覆盖本地内容） */
function ResyncDocumentButton({
  document: doc,
  projectId,
  onSynced,
}: {
  document: ProjectDocument
  projectId: number
  onSynced: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resync = () => {
    if (!doc.feishuUrl) return
    setLoading(true)
    setError(null)
    api
      .importFeishuDocument({
        projectId,
        type: doc.type as DocumentType,
        url: doc.feishuUrl,
      })
      .then(onSynced)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={resync}
        disabled={loading}
        title={error ?? '从飞书重新拉取最新内容'}
      >
        {loading ? '同步中…' : '同步'}
      </Button>
      {error && <span className="text-sm">{error}</span>}
    </>
  )
}

/** 文档类型选择（两个弹窗共用） */
function DocumentTypeSelect({
  value,
  onChange,
}: {
  value: DocumentType
  onChange: (v: DocumentType) => void
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DocumentType)}>
      <SelectTrigger>
        <SelectValue placeholder="选择文档类型" />
      </SelectTrigger>
      <SelectContent>
        {DOCUMENT_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {t}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** 创建文档（平台内直接编写） */
function CreateDocumentDialog({
  projectId,
  onCreated,
}: {
  projectId: number
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState<DocumentType>('需求')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = () => {
    setError(null)
    api
      .createDocument({ projectId, title, type, content: content || undefined })
      .then(() => {
        setOpen(false)
        setTitle('')
        setContent('')
        onCreated()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button variant="outline" size="sm">创建文档</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建文档</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              文档类型
              <DocumentTypeSelect value={type} onChange={setType} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="文档标题"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              内容（Markdown，可稍后补充）
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# 标题&#10;&#10;正文…"
                rows={6}
              />
            </label>
            {error && <p className="text-sm">创建失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!title.trim()}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 导入文档（飞书单向同步） */
function ImportDocumentDialog({
  projectId,
  onImported,
}: {
  projectId: number
  onImported: () => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [type, setType] = useState<DocumentType>('需求')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const submit = () => {
    setError(null)
    setLoading(true)
    api
      .importFeishuDocument({
        projectId,
        type,
        url,
        description: description || undefined,
      })
      .then(() => {
        setOpen(false)
        setUrl('')
        setDescription('')
        onImported()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button size="sm">导入文档</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>从飞书导入文档</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              文档类型
              <DocumentTypeSelect value={type} onChange={setType} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              飞书链接
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="支持 文档 / 表格 / 多维表格 / 知识库链接"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              文档描述（可不填）
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简单描述这份文档的用途…"
                rows={3}
              />
            </label>
            {error && <p className="text-sm">导入失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!url.trim() || loading}>
            {loading ? '导入中…' : '导入'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TestsPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const allTests = project.tests ?? []
  const tests = allTests.slice(0, 10)
  const [error, setError] = useState<string | null>(null)
  // 脚本路径显示时去掉与项目脚本目录重叠的前缀（tooltip 仍展示完整路径）
  const dirPrefix = project.scriptsPath
    ? `${project.scriptsPath.replace(/\/+$/, '')}/`
    : ''
  const displayScriptPath = (p: string) =>
    dirPrefix && p.startsWith(dirPrefix) ? p.slice(dirPrefix.length) : p
  return (
    <>
      {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">编号</TableHead>
            <TableHead>描述</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tests.map((t) => (
            <TableRow key={t.id}>
              <TableCell>
                <Link
                  to={`/projects/${project.id}/tests/${t.id}`}
                  className="underline"
                >
                  {t.code}
                </Link>
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.description ?? ''}>
                {t.description ?? '—'}
              </TableCell>
              <TableCell className="max-w-md truncate" title={t.scriptPath}>
                {displayScriptPath(t.scriptPath)}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center gap-2">
                  <RunTestButton test={t} projectId={project.id} />
                  <TestFormDialog
                    projectId={project.id}
                    test={t}
                    onSaved={onChanged}
                  />
                  <DeleteTestButton
                    test={t}
                    onDeleted={() =>
                      api
                        .deleteTest(t.id)
                        .then(onChanged)
                        .catch((e: Error) => setError(e.message))
                    }
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {tests.length === 0 && (
            <TableRow>
              <TableCell colSpan={4}>暂无测试</TableCell>
            </TableRow>
          )}
          <CountRow
            colSpan={4}
            total={allTests.length}
            displayed={tests.length}
          />
        </TableBody>
      </Table>
    </>
  )
}

/** 新建/编辑测试：脚本位置支持从 .test.ts 文件中自动联想、搜索 */
function TestFormDialog({
  projectId,
  test,
  onSaved,
}: {
  projectId: number
  /** 传入则为编辑，否则为新建 */
  test?: ProjectTest
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [scriptPath, setScriptPath] = useState('')
  const [scripts, setScripts] = useState<string[]>([])
  // 运行设备：server/h5 本地直跑；android/ios 走 appium-agent 远程
  const [device, setDevice] = useState<string>('server')
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单，并拉取脚本文件列表供自动联想
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setCode(test?.code ?? '')
      setDescription(test?.description ?? '')
      setScriptPath(test?.scriptPath ?? '')
      setDevice(test?.device ?? 'server')
      setError(null)
      api
        .listTestScripts(undefined, projectId)
        .then(setScripts)
        .catch(() => setScripts([]))
    }
  }

  const submit = () => {
    setError(null)
    const saving = test
      ? api.updateTest(test.id, { code, description, scriptPath, device })
      : api.createTest({
          projectId,
          code,
          description: description || undefined,
          scriptPath,
          device,
        })
    saving
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        {test ? (
          <Button variant="outline" size="sm">
            编辑
          </Button>
        ) : (
          <Button variant="outline" size="sm">添加测试</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{test ? '编辑测试' : '添加测试'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              编号（手工定义，项目内唯一）
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="如 TEST-001"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              描述（脚本测试的内容）
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个脚本测试什么…"
                rows={3}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              脚本（输入关键字自动联想 .test.ts 文件）
              <Autocomplete
                items={scripts}
                value={scriptPath}
                onValueChange={(v) => setScriptPath(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="如 projects/active/pk/tests/xxx.test.ts"
                  aria-label="脚本"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的脚本</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => (
                      <AutocompleteItem key={item} value={item}>
                        {item}
                      </AutocompleteItem>
                    )}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              运行设备（server/h5 本地直跑；android/ios 走 appium-agent 远程）
              <Select
                value={device}
                onValueChange={(v) => setDevice(v as string)}
                items={{
                  server: 'server（后端/服务端）',
                  h5: 'h5（前端页面）',
                  android: 'Android（appium）',
                  ios: 'iOS（appium）',
                }}
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="server">
                    server（后端/服务端）
                  </SelectItem>
                  <SelectItem value="h5">h5（前端页面）</SelectItem>
                  <SelectItem value="android">Android（appium）</SelectItem>
                  <SelectItem value="ios">iOS（appium）</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={!code.trim() || !scriptPath.trim()}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 自动导入测试：扫描项目脚本目录下全部 .test.ts，过滤已登记的全部导入 */
function ImportTestsButton({
  projectId,
  scriptsPath,
  onImported,
}: {
  projectId: number
  scriptsPath: string | null
  onImported: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = () => {
    if (!scriptsPath) {
      setMessage('请先在右侧设置项目的脚本目录，再执行自动导入')
      return
    }
    setLoading(true)
    setMessage(null)
    api
      .importTests(projectId)
      .then((r) => {
        setMessage(`已导入 ${r.created.length} 个，跳过 ${r.skipped} 个`)
        onImported()
      })
      .catch((e: Error) => setMessage(`导入失败:${e.message}`))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={loading}
        title="扫描脚本目录下的 .test.ts，未登记的全部导入（编号按文件名生成，描述待补充）"
      >
        {loading ? '导入中…' : '自动导入'}
      </Button>
      {message && <span className="text-sm text-foreground-muted">{message}</span>}
    </>
  )
}

/** 运行测试脚本：启动一次运行并跳转到运行详情页（实时进度/历史记录） */
function RunTestButton({
  test,
  projectId,
}: {
  test: ProjectTest
  projectId: number
}) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = () => {
    setLoading(true)
    setError(null)
    api
      .startTestRun(test.id)
      .then(() => navigate(`/projects/${projectId}/tests/${test.id}`))
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={run}
      disabled={loading}
      title={error ?? '启动一次脚本运行'}
    >
      {loading ? '启动中…' : '运行'}
    </Button>
  )
}

function DeleteTestButton({
  test,
  onDeleted,
}: {
  test: ProjectTest
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除测试</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除测试「{test.code}」吗？只删除登记信息，不影响脚本文件本身。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" onClick={onDeleted}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 任务板块：列表经 /api/tasks 独立拉取（含实时计算的下次执行时间），不随项目详情关系加载 */
function TasksSection({ project }: { project: Project }) {
  const [tasks, setTasks] = useState<ProjectTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [quickFilter, setQuickFilter] = useState<'all' | 'enabled' | 'disabled'>(
    'all',
  )

  const reload = useCallback(() => {
    api
      .listTasks(project.id)
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
  }, [project.id])

  useEffect(reload, [reload])

  const checks = project.checks ?? []
  const checkOf = (checkId: number) => checks.find((c) => c.id === checkId)
  const allTasks = tasks ?? []
  const filteredTasks =
    quickFilter === 'all'
      ? allTasks
      : allTasks.filter((t) =>
          quickFilter === 'enabled' ? t.enabled : !t.enabled,
        )
  const displayedTasks = filteredTasks.slice(0, 10)
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">任务</h2>
          {/* 快速筛选：未选中=对应语义浅色（启用=success、停用=warning），选中=深色背景浅色字体；再次点击当前项恢复全部 */}
          <FilterPill
            label="启用"
            tone="success"
            active={quickFilter === 'enabled'}
            onClick={() =>
              setQuickFilter((v) => (v === 'enabled' ? 'all' : 'enabled'))
            }
          />
          <FilterPill
            label="停用"
            tone="warning"
            active={quickFilter === 'disabled'}
            onClick={() =>
              setQuickFilter((v) => (v === 'disabled' ? 'all' : 'disabled'))
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/tasks?projectId=${project.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看全部
          </Link>
          <TaskFormDialog
            projectId={project.id}
            checks={project.checks ?? []}
            onSaved={reload}
          />
        </div>
      </div>
      {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead className="w-44">计划</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead className="w-24">运行</TableHead>
            <TableHead className="w-16 text-center">启用</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayedTasks.map((t) => {
            const check = checkOf(t.checkId)
            return (
              <TableRow key={t.id}>
                <TableCell className="max-w-md truncate" title={t.title}>
                  <Link
                    to={`/projects/${project.id}/tasks/${t.id}`}
                    className="underline"
                  >
                    {t.title}
                  </Link>
                </TableCell>
                <TableCell title={`执行周期：${t.cron}`}>
                  {t.nextRunAt ? new Date(t.nextRunAt).toLocaleString() : '—'}
                </TableCell>
                <TableCell className="max-w-md truncate">
                  {check ? (
                    <Link
                      to={`/projects/${project.id}/checks/${check.id}`}
                      className="underline"
                      title={check.scriptPath}
                    >
                      {check.code}
                    </Link>
                  ) : (
                    `#${t.checkId}`
                  )}
                </TableCell>
                <TableCell title="成功/失败/总运行次数（失败含异常）">
                  {t.runStats ? <RunStats stats={t.runStats} /> : '—'}
                </TableCell>
                <TableCell className="text-center">
                  <Switch
                    size="sm"
                    checked={t.enabled}
                    onCheckedChange={(checked) =>
                      api
                        .updateTask(t.id, { enabled: checked })
                        .then(reload)
                        .catch((e: Error) => setError(e.message))
                    }
                    title={
                      t.enabled
                        ? '已启用，到点正常执行；点击关闭后不再定时触发'
                        : '已停用，不参与调度；点击打开恢复定时执行'
                    }
                  />
                </TableCell>
                <TableCell className="text-center">
                  <div className="flex justify-center gap-2">
                    <TaskFormDialog
                      projectId={project.id}
                      checks={checks}
                      task={t}
                      onSaved={reload}
                    />
                    <DeleteTaskButton
                      task={t}
                      onDeleted={() =>
                        api
                          .deleteTask(t.id)
                          .then(reload)
                          .catch((e: Error) => setError(e.message))
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
          {tasks !== null && filteredTasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                {allTasks.length === 0
                  ? '暂无任务'
                  : quickFilter === 'all'
                    ? '暂无任务'
                    : '无符合筛选条件的任务'}
              </TableCell>
            </TableRow>
          )}
          <CountRow
            colSpan={6}
            total={filteredTasks.length}
            displayed={displayedTasks.length}
          />
        </TableBody>
      </Table>
    </>
  )
}

/** 新建/编辑任务：标题 + crontab 表达式 + 使用的检查脚本（本项目已登记检查）；任务详情页复用 */
export function TaskFormDialog({
  projectId,
  checks,
  task,
  onSaved,
}: {
  projectId: number
  /** 可选的检查脚本（本项目已登记检查） */
  checks: ProjectCheck[]
  /** 传入则为编辑，否则为新建 */
  task?: ProjectTask
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [cron, setCron] = useState('')
  const [checkId, setCheckId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTitle(task?.title ?? '')
      setCron(task?.cron ?? '')
      setCheckId(task ? String(task.checkId) : '')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    const saving = task
      ? api.updateTask(task.id, { title, cron, checkId: Number(checkId) })
      : api.createTask({
          projectId,
          title,
          cron,
          checkId: Number(checkId),
        })
    saving
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        {task ? (
          <Button variant="outline" size="sm">
            编辑
          </Button>
        ) : (
          <Button variant="outline" size="sm">添加任务</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{task ? '编辑任务' : '添加任务'}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              标题
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="如 每小时检查榜单数据"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              执行周期（crontab：分 时 日 月 周，可在最前加"秒"）
              <Input
                value={cron}
                onChange={(e) => setCron(e.target.value)}
                placeholder="如 */5 * * * *（每 5 分钟）或 */10 * * * * *（每 10 秒）"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              检查脚本（到点自动运行该检查）
              <Select
                value={checkId}
                onValueChange={(v) => setCheckId(v as string)}
                items={Object.fromEntries(
                  checks.map((c) => [String(c.id), `${c.code}（${c.scriptPath}）`]),
                )}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择检查" />
                </SelectTrigger>
                <SelectContent>
                  {checks.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.code}（{c.scriptPath}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {checks.length === 0 && (
              <p className="text-sm text-foreground-muted">
                项目还没有登记检查，请先在上方「检查」板块添加
              </p>
            )}
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={!title.trim() || !cron.trim() || !checkId}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteTaskButton({
  task,
  onDeleted,
}: {
  task: ProjectTask
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除任务</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除任务「{task.title}」吗？删除后不再定时触发，已产生的检查运行记录保留。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" onClick={onDeleted}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 缺陷板块：与项目设置的飞书多维表格双向绑定，列表随项目详情关系加载；标题栏含快速筛选（open/reopen、fixed） */
function DefectsPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const [quickFilter, setQuickFilter] = useState<'all' | 'pending' | 'fixed'>(
    'all',
  )
  const [error, setError] = useState<string | null>(null)
  const allDefects = project.defects ?? []
  const filteredDefects =
    quickFilter === 'all'
      ? allDefects
      : allDefects.filter((d) =>
          quickFilter === 'pending'
            ? d.status === 'open' || d.status === 'reopen'
            : d.status === 'fixed',
        )
  const defects = filteredDefects.slice(0, 10)
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">缺陷</h2>
          {/* 快速筛选：未选中=对应语义浅色（open/reopen=warning、fixed=success），选中=深色背景浅色字体；再次点击当前项恢复全部 */}
          <FilterPill
            label="open/reopen"
            tone="warning"
            active={quickFilter === 'pending'}
            onClick={() =>
              setQuickFilter((v) => (v === 'pending' ? 'all' : 'pending'))
            }
          />
          <FilterPill
            label="fixed"
            tone="success"
            active={quickFilter === 'fixed'}
            onClick={() =>
              setQuickFilter((v) => (v === 'fixed' ? 'all' : 'fixed'))
            }
          />
        </div>
        <div className="flex items-center gap-2">
          <Link
            to={`/defects?projectId=${project.id}`}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看全部
          </Link>
          <SyncDefectsButton project={project} onSynced={onChanged} />
        </div>
      </div>
      {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>问题描述</TableHead>
            <TableHead className="w-24 text-center">端</TableHead>
            <TableHead className="w-24 text-center">状态</TableHead>
            <TableHead className="w-32">人员</TableHead>
            <TableHead className="w-24 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {defects.map((d) => (
            <TableRow key={d.id}>
              <TableCell className="max-w-md truncate" title={d.title}>
                <Link
                  to={`/projects/${project.id}/defects/${d.id}`}
                  className="underline"
                >
                  {d.title}
                </Link>
              </TableCell>
              <TableCell className="text-center">{d.platform ?? '—'}</TableCell>
              <TableCell className="text-center">
                <DefectStatusBadge status={d.status} />
              </TableCell>
              <TableCell className="max-w-32 truncate">
                {d.assignee ?? '—'}
              </TableCell>
              <TableCell className="text-center">
                <DeleteDefectButton
                  defect={d}
                  onDeleted={() =>
                    api
                      .deleteDefect(d.id)
                      .then(onChanged)
                      .catch((e: Error) => setError(e.message))
                  }
                />
              </TableCell>
            </TableRow>
          ))}
          {defects.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>
                {allDefects.length === 0
                  ? '暂无缺陷，设置缺陷表格地址后点击「同步飞书」拉取'
                  : quickFilter === 'all'
                    ? '暂无缺陷'
                    : '无符合筛选条件的缺陷'}
              </TableCell>
            </TableRow>
          )}
          <CountRow
            colSpan={5}
            total={filteredDefects.length}
            displayed={defects.length}
          />
        </TableBody>
      </Table>
    </>
  )
}

/** 同步飞书：从项目绑定的缺陷多维表格全量拉取并覆盖本地 */
function SyncDefectsButton({
  project,
  onSynced,
}: {
  project: Project
  onSynced: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const run = () => {
    if (!project.defectBitableUrl) {
      setMessage('请先在右侧设置缺陷表格地址，再执行同步')
      return
    }
    setLoading(true)
    setMessage(null)
    api
      .syncDefects(project.id)
      .then((r) => {
        setMessage(`已同步 ${r.created + r.updated} 条（新增 ${r.created}，更新 ${r.updated}）`)
        onSynced()
      })
      .catch((e: Error) => setMessage(`同步失败:${e.message}`))
      .finally(() => setLoading(false))
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={loading}
        title="从飞书多维表格全量拉取缺陷，覆盖本地（测试脚本等本地字段保留）"
      >
        {loading ? '同步中…' : '同步飞书'}
      </Button>
      {message && <span className="text-sm text-foreground-muted">{message}</span>}
    </>
  )
}

function DeleteDefectButton({
  defect,
  onDeleted,
}: {
  defect: Defect
  onDeleted: () => void
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger>
        <Button variant="outline" size="sm">
          删除
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除缺陷</AlertDialogTitle>
          <AlertDialogDescription>
            确定删除缺陷「{defect.title}」吗？只删除本地记录，不影响飞书多维表格（再次同步会重新拉取）。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </AlertDialogClose>
          <AlertDialogClose>
            <Button variant="destructive" onClick={onDeleted}>
              确认删除
            </Button>
          </AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** 设置项目的缺陷多维表格地址（飞书 wiki/base 链接，须带 table 参数），缺陷与该表双向绑定 */
function EditDefectBitableDialog({
  project,
  onSaved,
}: {
  project: Project
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setUrl(project.defectBitableUrl ?? '')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateProject(project.id, { defectBitableUrl: url })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="ghost" size="sm">
          设置
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>设置缺陷表格地址</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              飞书多维表格链接（须带 table 参数，可带 view，留空解除绑定）
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="如 https://xxx.feishu.cn/wiki/XXX?table=tblXXX&view=vewXXX"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button onClick={submit}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** APP 版本板块：管理 APP 测试运行的 app 包元信息（版本/平台/应用/下载地址/md5） */
function AppVersionsPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api
      .listAppVersions(project.id)
      .then(setVersions)
      .catch((e: Error) => setError(e.message))
  }, [project.id])
  useEffect(() => {
    load()
  }, [load])

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">APP 版本</h2>
        <AppVersionFormDialog projectId={project.id} onSaved={onChanged} />
      </div>
      {error && <p className="mb-4 text-sm">加载失败:{error}</p>}
      <Table hoverableRows>
        <TableHeader>
          <TableRow>
            <TableHead>版本</TableHead>
            <TableHead className="w-24">平台</TableHead>
            <TableHead className="w-32">应用</TableHead>
            <TableHead>MD5</TableHead>
            <TableHead className="w-24 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.map((v) => (
            <TableRow key={v.id}>
              <TableCell>{v.version}</TableCell>
              <TableCell>{v.platform === 'ios' ? 'iOS' : 'Android'}</TableCell>
              <TableCell>{v.appTarget}</TableCell>
              <TableCell
                className="max-w-xs truncate font-mono text-xs"
                title={v.md5}
              >
                {v.md5}
              </TableCell>
              <TableCell className="text-center">
                <AlertDialog>
                  <AlertDialogTrigger>
                    <Button variant="ghost" size="sm">
                      删除
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>
                        删除 APP 版本 {v.version}？
                      </AlertDialogTitle>
                      <AlertDialogDescription>
                        此操作不可撤销。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogClose>
                        <Button variant="outline" size="sm">
                          取消
                        </Button>
                      </AlertDialogClose>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => {
                          api
                            .deleteAppVersion(v.id)
                            .then(onChanged)
                            .catch((e: Error) => setError(e.message))
                        }}
                      >
                        删除
                      </Button>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </TableCell>
            </TableRow>
          ))}
          {versions.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>暂无 APP 版本</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </>
  )
}

/** 新建 APP 版本：录入版本号/平台/应用/下载地址/md5 */
function AppVersionFormDialog({
  projectId,
  onSaved,
}: {
  projectId: number
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState<string>(APP_PLATFORMS[0])
  const [appTarget, setAppTarget] = useState<string>(APP_TARGETS[0])
  const [downloadUrl, setDownloadUrl] = useState('')
  const [md5, setMd5] = useState('')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setVersion('')
      setPlatform(APP_PLATFORMS[0])
      setAppTarget(APP_TARGETS[0])
      setDownloadUrl('')
      setMd5('')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .createAppVersion({
        projectId,
        platform,
        appTarget,
        version,
        downloadUrl,
        md5,
      })
      .then(() => {
        setOpen(false)
        onSaved()
      })
      .catch((e: Error) => setError(e.message))
  }

  const platformItems = Object.fromEntries(
    APP_PLATFORMS.map((p) => [p, p === 'ios' ? 'iOS' : 'Android']),
  )
  const targetItems = Object.fromEntries(APP_TARGETS.map((t) => [t, t]))

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        <Button variant="outline" size="sm">添加 APP 版本</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>添加 APP 版本</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              版本号
              <Input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="如 1.2.3"
              />
            </label>
            <div className="flex gap-4">
              <label className="flex flex-col gap-1 text-sm">
                平台
                <Select
                  value={platform}
                  onValueChange={(v) => setPlatform(v as string)}
                  items={platformItems}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_PLATFORMS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p === 'ios' ? 'iOS' : 'Android'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                应用
                <Select
                  value={appTarget}
                  onValueChange={(v) => setAppTarget(v as string)}
                  items={targetItems}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {APP_TARGETS.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              下载地址
              <Input
                value={downloadUrl}
                onChange={(e) => setDownloadUrl(e.target.value)}
                placeholder="app 包下载 URL"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              MD5
              <Input
                value={md5}
                onChange={(e) => setMd5(e.target.value)}
                placeholder="app 包 md5（agent 校验）"
              />
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">取消</Button>
          </DialogClose>
          <Button
            size="sm"
            onClick={submit}
            disabled={
              !version.trim() || !downloadUrl.trim() || !md5.trim()
            }
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

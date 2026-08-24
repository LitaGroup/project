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
import { Button } from '@appica/ui-react/button'
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
import {
  api,
  DOCUMENT_TYPES,
  type DocumentType,
  type Project,
  type ProjectCheck,
  type ProjectDocument,
  type ProjectTask,
  type ProjectTest,
} from '../lib/api'
import { StatusBadge } from '../components/StatusBadge'
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
              <ImportChecksButton projectId={project.id} scriptsPath={project.scriptsPath} onImported={reload} />
              <CheckFormDialog projectId={project.id} onSaved={reload} />
            </div>
          </div>
          <ChecksPanel project={project} onChanged={reload} />
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">测试</h2>
            <div className="flex items-center gap-2">
              <ImportTestsButton projectId={project.id} scriptsPath={project.scriptsPath} onImported={reload} />
              <TestFormDialog projectId={project.id} onSaved={reload} />
            </div>
          </div>
          <TestsPanel project={project} onChanged={reload} />
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
              <dt>飞书通知</dt>
              <dd className="flex items-center gap-1">
                <span className="max-w-40 truncate" title={project.feishuWebhook ?? ''}>
                  {project.feishuWebhook ?? '—'}
                </span>
                <EditWebhookDialog project={project} onSaved={reload} />
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
function ChecksPanel({
  project,
  onChanged,
}: {
  project: Project
  onChanged: () => void
}) {
  const checks = project.checks ?? []
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
              <TableCell className="max-w-md truncate" title={c.description ?? ''}>
                {c.description ?? '—'}
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
              <TableCell colSpan={4}>暂无检查</TableCell>
            </TableRow>
          )}
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
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单，并拉取脚本文件列表供自动联想
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setCode(check?.code ?? '')
      setDescription(check?.description ?? '')
      setScriptPath(check?.scriptPath ?? '')
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
      ? api.updateCheck(check.id, { code, description, scriptPath })
      : api.createCheck({
          projectId,
          code,
          description: description || undefined,
          scriptPath,
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

/** 设置项目的飞书群机器人 webhook：任务运行结束后推送执行结果到该群 */
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
          <DialogTitle>设置飞书通知</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              群机器人 webhook（任务运行结束后推送结果，留空则走平台默认群）
              <Input
                value={webhook}
                onChange={(e) => setWebhook(e.target.value)}
                placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
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
  const documents = project.documents ?? []
  return (
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
      </TableBody>
    </Table>
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
  const tests = project.tests ?? []
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
  const [error, setError] = useState<string | null>(null)

  // 打开时初始化表单，并拉取脚本文件列表供自动联想
  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setCode(test?.code ?? '')
      setDescription(test?.description ?? '')
      setScriptPath(test?.scriptPath ?? '')
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
      ? api.updateTest(test.id, { code, description, scriptPath })
      : api.createTest({
          projectId,
          code,
          description: description || undefined,
          scriptPath,
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

  const reload = useCallback(() => {
    api
      .listTasks(project.id)
      .then(setTasks)
      .catch((e: Error) => setError(e.message))
  }, [project.id])

  useEffect(reload, [reload])

  const checks = project.checks ?? []
  const checkOf = (checkId: number) => checks.find((c) => c.id === checkId)
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">任务</h2>
        <TaskFormDialog
          projectId={project.id}
          checks={project.checks ?? []}
          onSaved={reload}
        />
      </div>
      {error && <p className="mb-2 text-sm">操作失败:{error}</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>标题</TableHead>
            <TableHead className="w-44">计划</TableHead>
            <TableHead>脚本</TableHead>
            <TableHead className="w-24">运行</TableHead>
            <TableHead className="w-40 text-center">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(tasks ?? []).map((t) => {
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
          {tasks !== null && tasks.length === 0 && (
            <TableRow>
              <TableCell colSpan={5}>暂无任务</TableCell>
            </TableRow>
          )}
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

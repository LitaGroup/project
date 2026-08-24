import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Viewer } from '@bytemd/react'
import gfm from '@bytemd/plugin-gfm'
import 'bytemd/dist/index.css'
import 'github-markdown-css/github-markdown.css'
import {
  Card,
  CardHeader,
  CardTitle,
} from '@appica/ui-react/card'
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
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteItem,
} from '@appica/ui-react/autocomplete'
import { Button } from '@appica/ui-react/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  api,
  DEFECT_PLATFORMS,
  DEFECT_STATUSES,
  type Defect,
  type DefectStatus,
  type ProjectTest,
} from '../lib/api'
import { DefectStatusBadge } from '../components/StatusBadge'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

const plugins = [gfm()]

/** 缺陷详情：问题描述 + 截图 + 属性编辑（端/状态/测试脚本），状态/端变更后回写飞书 */
export function DefectDetailPage() {
  const { id, defectId } = useParams<{ id: string; defectId: string }>()
  const projectId = Number(id)
  const defectIdNum = Number(defectId)

  const [defect, setDefect] = useState<Defect | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    api
      .getDefect(defectIdNum)
      .then(setDefect)
      .catch((e: Error) => setError(e.message))
  }, [defectIdNum])

  useEffect(() => {
    reload()
    api
      .getProject(projectId)
      .then((p) => setProjectName(p.name))
      .catch(() => setProjectName(null))
  }, [projectId, reload])

  if (error && !defect) return <p>加载失败:{error}</p>
  if (!defect) return <p>加载中…</p>

  return (
    <div className="flex gap-6">
      {/* 左侧：问题描述 + 截图 */}
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        <PageBreadcrumb
          items={[
            { label: '缺陷', to: '/defects' },
            { label: projectName ?? '…', to: `/projects/${projectId}` },
            { label: defect.title },
          ]}
        />
        <section>
          <h2 className="mb-3 text-xl font-semibold">问题描述</h2>
          <Card>
            <div className="markdown-body px-6 py-4 text-sm">
              <Viewer value={defect.description ?? defect.title} plugins={plugins} />
            </div>
          </Card>
        </section>
        <section>
          <h2 className="mb-3 text-xl font-semibold">
            截图（{defect.images?.length ?? 0}）
          </h2>
          {defect.images && defect.images.length > 0 ? (
            <div className="flex flex-wrap gap-3">
              {defect.images.map((p) => (
                <a
                  key={p}
                  href={`/images/${p}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={`/images/${p}`}
                    alt="缺陷截图"
                    className="h-40 rounded-[var(--radius-md)] border border-border-strong object-cover"
                  />
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm">暂无截图</p>
          )}
        </section>
        {defect.remark && (
          <section>
            <h2 className="mb-3 text-xl font-semibold">备注</h2>
            <p className="whitespace-pre-wrap text-sm">{defect.remark}</p>
          </section>
        )}
      </div>

      {/* 右侧：属性 */}
      <aside className="w-80 shrink-0">
        <Card>
          <CardHeader>
            <CardTitle>缺陷信息</CardTitle>
          </CardHeader>
          <dl className="flex flex-col gap-3 px-6 pb-6 text-sm">
            <div className="flex items-center justify-between">
              <dt>状态</dt>
              <dd className="flex items-center gap-2">
                <DefectStatusBadge status={defect.status} />
                <StatusSelect defect={defect} onChanged={reload} />
              </dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>端</dt>
              <dd className="flex items-center gap-1">
                <span>{defect.platform ?? '—'}</span>
                <EditPlatformDialog defect={defect} onSaved={reload} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>人员</dt>
              <dd>{defect.assignee ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt>测试脚本</dt>
              <dd className="flex items-center gap-1">
                <span
                  className="max-w-40 truncate"
                  title={defect.testScript ?? ''}
                >
                  {defect.testScript ?? '—'}
                </span>
                <EditTestScriptDialog defect={defect} onSaved={reload} />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>飞书记录</dt>
              <dd>{defect.feishuRecordId ?? '—'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>更新时间</dt>
              <dd>{new Date(defect.updatedAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="px-6 pb-6">
            <VerifyButton defect={defect} />
            {defect.testScript ? (
              <p className="mt-2 text-xs text-foreground-muted">
                标记 fixed 前需测试脚本最近一次运行通过
              </p>
            ) : (
              <p className="mt-2 text-xs text-foreground-muted">
                未配置测试脚本，可手动标记 fixed
              </p>
            )}
          </div>
        </Card>
      </aside>
    </div>
  )
}

/** 修改状态：改 fixed 时后端校验测试脚本（有脚本须最近一次运行通过）；变更后回写飞书 */
function StatusSelect({
  defect,
  onChanged,
}: {
  defect: Defect
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)

  const change = (status: string) => {
    if (status === defect.status) return
    setError(null)
    api
      .updateDefect(defect.id, { status: status as DefectStatus })
      .then(onChanged)
      .catch((e: Error) => setError(e.message))
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Select
        value={defect.status}
        onValueChange={(v) => change(v as string)}
        items={Object.fromEntries(
          (DEFECT_STATUSES.includes(defect.status as DefectStatus)
            ? DEFECT_STATUSES
            : [...DEFECT_STATUSES, defect.status]
          ).map((s) => [s, s]),
        )}
      >
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(DEFECT_STATUSES.includes(defect.status as DefectStatus)
            ? DEFECT_STATUSES
            : [...DEFECT_STATUSES, defect.status]
          ).map((s) => (
            <SelectItem key={s} value={s}>
              {s}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="text-xs">{error}</span>}
    </span>
  )
}

/** 运行验证：启动缺陷测试脚本的一次运行，跳转到测试运行页查看结果 */
function VerifyButton({ defect }: { defect: Defect }) {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!defect.testScript) return null

  const run = () => {
    setLoading(true)
    setError(null)
    api
      .verifyDefect(defect.id)
      .then((r) =>
        navigate(`/projects/${defect.projectId}/tests/${r.testId}`),
      )
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  return (
    <>
      <Button
        size="sm"
        className="w-full"
        onClick={run}
        disabled={loading}
        title={error ?? '运行测试脚本验证缺陷是否已修复'}
      >
        {loading ? '启动中…' : '运行验证'}
      </Button>
      {error && <p className="mt-2 text-xs">操作失败:{error}</p>}
    </>
  )
}

/** 编辑端：下拉选择 前端/后端/APP端/未知（默认），变更后回写飞书 */
function EditPlatformDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [platform, setPlatform] = useState('未知')
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setPlatform(defect.platform ?? '未知')
      setError(null)
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateDefect(defect.id, { platform })
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
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑端</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              端
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as string)}
                items={Object.fromEntries(DEFECT_PLATFORMS.map((p) => [p, p]))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择端" />
                </SelectTrigger>
                <SelectContent>
                  {DEFECT_PLATFORMS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 编辑测试脚本：带搜索的选择器，从项目已登记的测试中选取（存脚本相对路径） */
function EditTestScriptDialog({
  defect,
  onSaved,
}: {
  defect: Defect
  onSaved: () => void
}) {
  const [open, setOpen] = useState(false)
  const [testScript, setTestScript] = useState('')
  const [tests, setTests] = useState<ProjectTest[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setTestScript(defect.testScript ?? '')
      setError(null)
      api
        .listTests(defect.projectId)
        .then(setTests)
        .catch(() => setTests([]))
    }
  }

  const submit = () => {
    setError(null)
    api
      .updateDefect(defect.id, { testScript })
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
          编辑
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑测试脚本</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm">
              测试（从项目已登记的测试中选择，可搜索，清除可留空）
              <Autocomplete
                items={tests.map((t) => t.scriptPath)}
                value={testScript}
                onValueChange={(v) => setTestScript(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="搜索测试编号或脚本…"
                  aria-label="测试"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的测试</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => {
                      const t = tests.find((x) => x.scriptPath === item)
                      return (
                        <AutocompleteItem key={item} value={item}>
                          {t ? `${t.code}（${t.scriptPath}）` : item}
                        </AutocompleteItem>
                      )
                    }}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
            </label>
            <p className="text-xs text-foreground-muted">
              配置后标记 fixed 前须该测试脚本最近一次运行通过
            </p>
            {error && <p className="text-sm">保存失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

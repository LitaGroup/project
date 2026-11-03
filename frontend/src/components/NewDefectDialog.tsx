import { useEffect, useState } from 'react'
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
import { Textarea } from '@appica/ui-react/textarea'
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
  DEFECT_PRIORITIES,
  type Defect,
  type DefectPriority,
  type Project,
  type ProjectRelease,
  type ProjectTest,
} from '../lib/api'
import { DefectImagesField } from './DefectImagesField'

interface NewDefectPreset {
  projectId?: number
  testScript?: string
  expected?: string
  actual?: string
}

/**
 * 新建缺陷弹窗（属性：端/预期/实际/图片/用例脚本）。
 * 可用于全局缺陷页（多项目选择）、项目详情页（锁定项目）、测试运行页（携带失败用例预填）。
 */
export function NewDefectDialog({
  projects,
  preset,
  trigger,
  onCreated,
}: {
  projects: Pick<Project, 'id' | 'name'>[]
  preset?: NewDefectPreset
  trigger?: React.ReactElement
  onCreated?: (defect: Defect) => void
}) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [platform, setPlatform] = useState('未知')
  const [priority, setPriority] = useState('中')
  const [expected, setExpected] = useState('')
  const [actual, setActual] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [testScript, setTestScript] = useState('')
  const [tests, setTests] = useState<ProjectTest[]>([])
  // auto=交给平台关联最新有效提测；none=显式不关联；其他值为指定提测 ID
  const [releaseSelection, setReleaseSelection] = useState('auto')
  const [releases, setReleases] = useState<ProjectRelease[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setProjectId(preset?.projectId ?? projects[0]?.id ?? null)
      setPlatform('未知')
      setPriority('中')
      setExpected(preset?.expected ?? '')
      setActual(preset?.actual ?? '')
      setImages([])
      setTestScript(preset?.testScript ?? '')
      setReleaseSelection('auto')
      setError(null)
    }
  }

  // 加载所选项目已登记的测试与提测记录（用例联想 / 提测关联）
  useEffect(() => {
    if (!open || projectId === null) {
      setTests([])
      setReleases([])
      return
    }
    setReleaseSelection('auto')
    api
      .listTests(projectId)
      .then(setTests)
      .catch(() => setTests([]))
    api
      .listReleases(projectId)
      .then(setReleases)
      .catch(() => setReleases([]))
  }, [open, projectId])

  const submit = () => {
    if (projectId === null) {
      setError('请选择所属项目')
      return
    }
    if (!expected.trim()) {
      setError('预期功能描述不能为空')
      return
    }
    if (!actual.trim()) {
      setError('实际结果描述不能为空')
      return
    }
    setSaving(true)
    setError(null)
    api
      .createDefect({
        projectId,
        expected,
        actual,
        platform,
        priority: priority as DefectPriority,
        images: images.length > 0 ? images : undefined,
        testScript,
        releaseId:
          releaseSelection === 'auto'
            ? undefined
            : releaseSelection === 'none'
              ? null
              : Number(releaseSelection),
      })
      .then((d) => {
        setOpen(false)
        onCreated?.(d)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const releaseItems = {
    auto: '自动关联（项目最新有效提测）',
    none: '不关联提测',
    ...Object.fromEntries(
      releases.map((r) => [
        String(r.id),
        `#${r.id} · ${r.status} · ${new Date(r.createdAt).toLocaleString()} · ${r.operator ?? '—'}`,
      ]),
    ),
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={trigger ?? <Button size="sm">新建缺陷</Button>} />
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建缺陷</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                所属项目
                <Select
                  value={projectId !== null ? String(projectId) : ''}
                  onValueChange={(v) => setProjectId(v ? Number(v) : null)}
                  items={Object.fromEntries(
                    projects.map((p) => [String(p.id), p.name]),
                  )}
                  disabled={preset?.projectId !== undefined}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择项目" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                端
                <Select
                  value={platform}
                  onValueChange={(v) => setPlatform(v as string)}
                  items={Object.fromEntries(
                    DEFECT_PLATFORMS.map((p) => [p, p]),
                  )}
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
              <label className="flex flex-col gap-1 text-sm">
                优先级
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as string)}
                  items={Object.fromEntries(
                    DEFECT_PRIORITIES.map((p) => [p, p]),
                  )}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择优先级" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEFECT_PRIORITIES.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm">
              预期功能描述
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={3}
                placeholder="功能预期表现…"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              实际结果描述
              <Textarea
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={3}
                placeholder="实际表现与差异…"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              提测 ID（表明缺陷与哪次提测相关，可留空）
              <Select
                value={releaseSelection}
                onValueChange={(v) => setReleaseSelection(v as string)}
                items={releaseItems}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择提测" />
                </SelectTrigger>
                <SelectContent>
                  {Object.keys(releaseItems).map((key) => (
                    <SelectItem key={key} value={key}>
                      {releaseItems[key as keyof typeof releaseItems]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-foreground-muted">
                默认自动关联项目最新有效提测；选择「不关联」或指定提测后，平台不再自动派发缺陷处理任务。
              </span>
            </label>
            <DefectImagesField value={images} onChange={setImages} />
            <label className="flex flex-col gap-1 text-sm">
              用例脚本（从项目已登记的测试中选择，可搜索，可留空）
              <Autocomplete
                items={tests.map((t) => t.scriptPath)}
                value={testScript}
                onValueChange={(v) => setTestScript(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="搜索测试编号或脚本…"
                  aria-label="用例脚本"
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
            {error && <p className="text-sm">创建失败:{error}</p>}
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>
            <Button variant="outline" size="sm">
              取消
            </Button>
          </DialogClose>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '创建中…' : '创建'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

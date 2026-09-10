import { useEffect, useRef, useState } from 'react'
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
import { Input } from '@appica/ui-react/input'
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
  type Defect,
  type DefectSource,
  type Project,
  type ProjectTest,
} from '../lib/api'

interface NewDefectPreset {
  projectId?: number
  testScript?: string
  title?: string
  steps?: string
  expected?: string
  actual?: string
  /** 来源：脚本（测试运行一键生成）/录入（人工），缺省录入 */
  source?: DefectSource
}

/**
 * 新建缺陷弹窗（来源：脚本/录入）。
 * 可用于全局缺陷页（多项目选择）、项目详情页（锁定项目）、测试运行页（携带失败用例预填）。
 */
export function NewDefectDialog({
  projects,
  preset,
  trigger,
  onCreated,
}: {
  projects: Project[]
  preset?: NewDefectPreset
  trigger?: React.ReactNode
  onCreated?: (defect: Defect) => void
}) {
  const [open, setOpen] = useState(false)
  const [projectId, setProjectId] = useState<number | null>(null)
  const [title, setTitle] = useState('')
  const [platform, setPlatform] = useState('未知')
  const [steps, setSteps] = useState('')
  const [expected, setExpected] = useState('')
  const [actual, setActual] = useState('')
  const [testScript, setTestScript] = useState('')
  const [developer, setDeveloper] = useState('')
  const [tester, setTester] = useState('')
  const [tests, setTests] = useState<ProjectTest[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const stepsRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setProjectId(preset?.projectId ?? projects[0]?.id ?? null)
      setTitle(preset?.title ?? '')
      setPlatform('未知')
      setSteps(preset?.steps ?? '')
      setExpected(preset?.expected ?? '')
      setActual(preset?.actual ?? '')
      setTestScript(preset?.testScript ?? '')
      setDeveloper('')
      setTester('')
      setError(null)
    }
  }

  // 加载所选项目已登记的测试，供用例脚本联想
  useEffect(() => {
    if (!open || projectId === null) return
    api
      .listTests(projectId)
      .then(setTests)
      .catch(() => setTests([]))
  }, [open, projectId])

  const uploadImage = (file: File) => {
    setUploading(true)
    setError(null)
    api
      .uploadImage(file)
      .then(({ url }) => {
        const textarea = stepsRef.current
        const markdown = `![](${url})`
        if (textarea) {
          const start = textarea.selectionStart ?? steps.length
          const end = textarea.selectionEnd ?? steps.length
          setSteps(`${steps.slice(0, start)}${markdown}${steps.slice(end)}`)
          requestAnimationFrame(() => {
            textarea.focus()
            textarea.setSelectionRange(
              start + markdown.length,
              start + markdown.length,
            )
          })
        } else {
          setSteps((prev) => `${prev}${markdown}`)
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setUploading(false)
        if (fileRef.current) fileRef.current.value = ''
      })
  }

  const submit = () => {
    if (projectId === null) {
      setError('请选择所属项目')
      return
    }
    if (!title.trim()) {
      setError('简述（标题）不能为空')
      return
    }
    setSaving(true)
    setError(null)
    api
      .createDefect({
        projectId,
        title,
        source: preset?.source ?? '录入',
        platform,
        steps,
        expected,
        actual,
        testScript,
        developer,
        tester,
      })
      .then((d) => {
        setOpen(false)
        onCreated?.(d)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger>
        {trigger ?? (
          <Button size="sm">新建缺陷</Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建缺陷</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4">
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
            </div>
            <label className="flex flex-col gap-1 text-sm">
              简述
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="简要描述"
              />
            </label>
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center justify-between">
                <span>操作步骤与关键信息（Markdown）</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? '上传中…' : '上传图片'}
                </Button>
              </div>
              <Textarea
                ref={stepsRef}
                value={steps}
                onChange={(e) => setSteps(e.target.value)}
                rows={6}
                placeholder="1. 操作步骤…&#10;2. 关键信息…"
              />
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) uploadImage(file)
                }}
              />
            </div>
            <label className="flex flex-col gap-1 text-sm">
              预期
              <Textarea
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={2}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              实际
              <Textarea
                value={actual}
                onChange={(e) => setActual(e.target.value)}
                rows={2}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              用例（从项目已登记的测试中选择，可搜索，可留空）
              <Autocomplete
                items={tests.map((t) => t.scriptPath)}
                value={testScript}
                onValueChange={(v) => setTestScript(v as string)}
                clearable
              >
                <AutocompleteInput
                  placeholder="搜索测试编号或脚本…"
                  aria-label="用例"
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
            <div className="grid grid-cols-2 gap-4">
              <label className="flex flex-col gap-1 text-sm">
                开发
                <Input
                  value={developer}
                  onChange={(e) => setDeveloper(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                测试
                <Input
                  value={tester}
                  onChange={(e) => setTester(e.target.value)}
                />
              </label>
            </div>
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

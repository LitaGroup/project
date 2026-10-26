import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import { api } from '../lib/api'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

/**
 * 新建任务（独立页面）：只填写任务描述（Markdown）。
 * 创建后进入「等待中-待识别」，LOOP 每秒扫描并交给系统调度机器人识别，
 * 识别结果会补全标题/输入/输出/类型/工作计划并自动分配机器人。
 */
export function TaskCreatePage() {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就创建丢字
    const markdown = descriptionRef.current?.getMarkdown() ?? description
    if (!markdown.trim()) {
      setError('请填写任务描述')
      return
    }
    setSaving(true)
    api
      .createTaskPackage({ description: markdown })
      .then(() => navigate('/tasks/list'))
      .catch((e: Error) => setError(`创建失败：${e.message}`))
      .finally(() => setSaving(false))
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <PageBreadcrumb
            items={[
              { label: '任务', to: '/tasks/list' },
              { label: '新建任务' },
            ]}
          />
          <h1 className="mt-2 text-2xl font-semibold">新建任务</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            填写任务描述即可；创建后进入「等待中-待识别」，系统调度机器人会自动识别并补全标题、输入、输出与工作计划
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/tasks/list')}
          >
            取消
          </Button>
          <Button size="sm" onClick={submit} disabled={saving}>
            {saving ? '创建中…' : '创建任务'}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm">
          {error}
        </p>
      )}

      {/* 与「新建机器人」一致：单个 Markdown 编辑卡片撑满剩余高度 */}
      <Card className="min-h-64 min-w-0 flex-1">
        <CardHeader className="flex-none">
          <CardTitle>任务描述</CardTitle>
          <CardDescription>
            使用 Markdown 描述任务目标、背景与期望产出，派发时随任务一起下发给机器人
          </CardDescription>
        </CardHeader>
        <div className="relative mx-2 mb-2 min-h-0 flex-1">
          <div className="absolute inset-0 overflow-auto bg-background-muted">
            <MarkdownEditor
              ref={descriptionRef}
              value=""
              compact
              appica
              onChange={setDescription}
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Button } from '@appica/ui-react/button'
import {
  Autocomplete,
  AutocompleteInput,
  AutocompleteContent,
  AutocompleteEmpty,
  AutocompleteList,
  AutocompleteItem,
} from '@appica/ui-react/autocomplete'
import { api, type TaskTemplate, type Worker } from '../lib/api'
import { matchesPinyinSearch } from '../lib/pinyin-search'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import {
  MarkdownEditor,
  type MarkdownEditorHandle,
} from '../components/MarkdownEditor'

/**
 * 新建任务（独立页面）：填写任务描述（Markdown），右侧可选任务定义与执行机器人。
 * 选择任务定义时若执行机器人未手动指定，自动从该定义的启用机器人中随机带入；
 * 机器人留空时由平台按任务定义自动分配，无法匹配时归入「未知任务」。
 */
export function TaskCreatePage() {
  const navigate = useNavigate()
  const [description, setDescription] = useState('')
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [templateName, setTemplateName] = useState('')
  const [agentName, setAgentName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const descriptionRef = useRef<MarkdownEditorHandle>(null)
  // 记录上一次由任务定义自动填入的机器人；手动选择/清空后置空
  const autoAgentIdRef = useRef<number | null>(null)

  useEffect(() => {
    // 同时加载，避免先选任务定义时机器人清单尚未就绪导致无法自动带入
    Promise.allSettled([
      api.listTaskTemplates(),
      api.listWorkers({ role: '工作者' }),
    ]).then(([templateResult, workerResult]) => {
      if (templateResult.status === 'fulfilled') {
        setTemplates(templateResult.value)
      }
      if (workerResult.status === 'fulfilled') {
        setWorkers(
          workerResult.value.filter((worker) => worker.enabled),
        )
      }
    })
  }, [])

  const templateOptions = useMemo(
    () => templates.map((template) => template.name),
    [templates],
  )
  const workerOptions = useMemo(
    () => workers.map((worker) => worker.name),
    [workers],
  )

  /**
   * 任务定义支持输入搜索，匹配到完整名称时视为已选择：
   * - 执行机器人为空或仍是上次自动填入值时，从定义的启用机器人中随机选一个；
   * - 手动选择过机器人时保持手动值；
   * - 清除定义时只清除自动填入的机器人，保留手动选择。
   */
  const changeTemplate = (value: string | null) => {
    const next = value ?? ''
    setTemplateName(next)
    const currentAgent = workers.find(
      (worker) => worker.name === agentName.trim(),
    )
    const isAutoAgent =
      autoAgentIdRef.current !== null &&
      currentAgent?.id === autoAgentIdRef.current
    const template = templates.find((item) => item.name === next.trim())
    if (!template) {
      autoAgentIdRef.current = null
      if (isAutoAgent) setAgentName('')
      return
    }
    if (agentName.trim() && !isAutoAgent) return
    const candidates = [...new Set(template.agentIds)]
      .map((id) => workers.find((worker) => worker.id === id))
      .filter((worker): worker is Worker => Boolean(worker))
    if (candidates.length === 0) {
      autoAgentIdRef.current = null
      if (isAutoAgent) setAgentName('')
      return
    }
    const selected = candidates[Math.floor(Math.random() * candidates.length)]
    autoAgentIdRef.current = selected.id
    setAgentName(selected.name)
  }

  /** 手动选择/清空执行机器人：之后切换任务定义不再覆盖该值 */
  const changeAgent = (value: string | null) => {
    autoAgentIdRef.current = null
    setAgentName(value ?? '')
  }

  const submit = () => {
    setError(null)
    // 取编辑器当前内容：onChange 有防抖，避免刚输入就创建丢字
    const markdown = descriptionRef.current?.getMarkdown() ?? description
    if (!markdown.trim()) {
      setError('请填写任务描述')
      return
    }
    const selectedTemplate = templates.find(
      (template) => template.name === templateName.trim(),
    )
    const selectedAgent = workers.find(
      (worker) => worker.name === agentName.trim(),
    )
    if (templateName.trim() && !selectedTemplate) {
      setError('请从联想结果中选择任务定义，或清空该项')
      return
    }
    if (agentName.trim() && !selectedAgent) {
      setError('请从联想结果中选择执行机器人，或清空该项')
      return
    }
    setSaving(true)
    api
      .createTaskPackage({
        description: markdown,
        templateId: selectedTemplate?.id ?? null,
        // 留空由平台按任务定义自动分配；仍无法匹配时归入「未知任务」
        agentId: selectedAgent?.id ?? null,
      })
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
            填写任务描述即可；可指定任务定义与执行机器人，执行机器人留空时由平台自动分配，无法匹配时归入「未知任务」
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

      {/* 布局参考「新建机器人」：左侧 Markdown 编辑区撑满剩余高度，右侧基础信息独立滚动 */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <Card className="min-h-64 min-w-0 flex-1 rounded-none">
          <CardHeader className="flex-none">
            <CardTitle>任务描述</CardTitle>
            <CardDescription>
              使用 Markdown 描述任务目标、背景与期望产出，派发时随任务一起下发给机器人
            </CardDescription>
          </CardHeader>
          <div className="relative mx-2 mb-2 min-h-0 flex-1">
            <div className="md-editor-scroll absolute inset-0 bg-background-muted">
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

        <Card className="w-full shrink-0 lg:min-h-0 lg:w-[22rem]">
          <CardHeader className="flex-none">
            <CardTitle>基础信息</CardTitle>
            <CardDescription>
              任务定义与执行机器人都可留空；留空时由平台自动分配
            </CardDescription>
          </CardHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto px-4 pb-4">
            <label className="flex flex-col gap-1 text-sm">
              任务定义
              <Autocomplete
                items={templateOptions}
                value={templateName}
                onValueChange={(value) => changeTemplate(value as string)}
                filter={(item: unknown, query: string) =>
                  matchesPinyinSearch(query, [String(item)])
                }
                clearable
                openOnInputClick
              >
                <AutocompleteInput
                  placeholder="搜索任务定义名称或拼音，可留空"
                  aria-label="任务定义"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的任务定义</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => (
                      <AutocompleteItem key={item} value={item}>
                        {item}
                      </AutocompleteItem>
                    )}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
              <span className="text-xs text-foreground-muted">
                可留空；支持名称、全拼或首字母搜索，选中后自动带入该定义配置的执行机器人
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              执行机器人
              <Autocomplete
                items={workerOptions}
                value={agentName}
                onValueChange={(value) => changeAgent(value as string)}
                filter={(item: unknown, query: string) =>
                  matchesPinyinSearch(query, [String(item)])
                }
                clearable
                openOnInputClick
              >
                <AutocompleteInput
                  placeholder="搜索机器人名称或拼音，留空自动分配"
                  aria-label="执行机器人"
                />
                <AutocompleteContent>
                  <AutocompleteEmpty>未找到匹配的机器人</AutocompleteEmpty>
                  <AutocompleteList>
                    {(item: string) => (
                      <AutocompleteItem key={item} value={item}>
                        {item}
                      </AutocompleteItem>
                    )}
                  </AutocompleteList>
                </AutocompleteContent>
              </Autocomplete>
              <span className="text-xs text-foreground-muted">
                可搜索、手动更改或留空；留空后由后台自动分配
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@appica/ui-react/card'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import { Switch } from '@appica/ui-react/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@appica/ui-react/select'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import {
  api,
  MODEL_THINKING_LEVELS,
  MODEL_THINKING_LEVEL_LABELS,
  type ModelScenarioConfig,
  type ModelThinkingLevel,
} from '../lib/api'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

/** 单个场景配置卡片：独立管理表单、模型列表与按钮反馈 */
function ScenarioCard({
  config,
  onSaved,
}: {
  config: ModelScenarioConfig
  onSaved: () => void
}) {
  const [baseUrl, setBaseUrl] = useState(config.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [model, setModel] = useState(config.model ?? '')
  const [thinking, setThinking] = useState<ModelThinkingLevel>(
    config.thinking,
  )
  const [models, setModels] = useState<string[]>(
    config.model ? [config.model] : [],
  )
  const [fetching, setFetching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [fetchFeedback, setFetchFeedback] = useState<Feedback>(null)

  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = (ref: {
    current: ReturnType<typeof setTimeout> | null
  }) => {
    if (ref.current !== null) {
      clearTimeout(ref.current)
      ref.current = null
    }
  }

  useEffect(() => {
    return () => {
      clearTimer(feedbackTimerRef)
      clearTimer(fetchTimerRef)
    }
  }, [])

  // 保存/刷新后配置引用变化：重置表单，apiKey 输入框保持为空（不回显）
  useEffect(() => {
    setBaseUrl(config.baseUrl ?? '')
    setApiKey('')
    setClearApiKey(false)
    setModel(config.model ?? '')
    setThinking(config.thinking)
    setModels(config.model ? [config.model] : [])
  }, [config])

  const showFeedback = (
    next: NonNullable<Feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer(feedbackTimerRef)
    setFeedback(next)
    feedbackTimerRef.current = setTimeout(() => {
      feedbackTimerRef.current = null
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const showFetchFeedback = (next: NonNullable<Feedback>, stayMs: number) => {
    clearTimer(fetchTimerRef)
    setFetchFeedback(next)
    fetchTimerRef.current = setTimeout(() => {
      fetchTimerRef.current = null
      setFetchFeedback(null)
    }, stayMs)
  }

  const modelOptions = Array.from(
    new Set([...(config.model ? [config.model] : []), ...models]),
  ).filter(Boolean)
  const modelItems = Object.fromEntries(
    modelOptions.map((value) => [value, value]),
  )

  const fetchModels = async () => {
    if (fetching || fetchFeedback?.kind === 'success') return
    setFetching(true)
    setFetchFeedback(null)
    try {
      const list = await api.fetchModelOptions(config.scenario, {
        baseUrl: baseUrl.trim() || null,
        apiKey: apiKey.trim() || null,
      })
      setModels(list)
      if (!model.trim() || !list.includes(model.trim())) {
        setModel(list[0] ?? model)
      }
      showFetchFeedback(
        { kind: 'success', message: `已拉取 ${list.length} 个模型` },
        SUCCESS_STAY_MS,
      )
    } catch (e) {
      showFetchFeedback(
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '拉取模型列表失败',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setFetching(false)
    }
  }

  const submit = async () => {
    if (saving || feedback?.kind === 'success') return
    if (!baseUrl.trim()) {
      showFeedback(
        { kind: 'failure', message: '请填写 Base URL' },
        FAILURE_STAY_MS,
      )
      return
    }
    if (!model.trim()) {
      showFeedback(
        { kind: 'failure', message: '请选择模型' },
        FAILURE_STAY_MS,
      )
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      await api.saveModelConfig(config.scenario, {
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        thinking,
        // 留空保持不变；勾选清除或显式清除时传空串
        ...(clearApiKey
          ? { apiKey: '' }
          : apiKey.trim()
            ? { apiKey: apiKey.trim() }
            : {}),
      })
      showFeedback({ kind: 'success', message: '已保存' }, SUCCESS_STAY_MS, () => {
        onSaved()
      })
    } catch (e) {
      showFeedback(
        {
          kind: 'failure',
          message: e instanceof Error ? e.message : '保存失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>{config.name}</CardTitle>
          <Badge variant={config.configured ? 'success' : 'soft'}>
            {config.configured ? '已配置' : '未配置'}
          </Badge>
        </div>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <div className="grid gap-4 px-6 pb-6">
        <label className="grid gap-1.5 text-sm">
          <span>Base URL</span>
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
          />
          <span className="text-xs text-foreground-muted">
            OpenAI 兼容地址，平台请求 {'{baseURL}'}/chat/completions 与{' '}
            {'{baseURL}'}/models；末尾斜杠会自动去除。
          </span>
        </label>
        <label className="grid gap-1.5 text-sm">
          <span>
            API Key
            {config.hasApiKey && (
              <span className="ml-1 text-xs text-foreground-muted">
                （已配置，留空保持不变）
              </span>
            )}
          </span>
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              if (e.target.value) setClearApiKey(false)
            }}
            placeholder={config.hasApiKey ? '留空保持不变' : '填写 API Key'}
          />
          {config.hasApiKey && (
            <span className="flex items-center gap-2 text-xs text-foreground-muted">
              <Switch
                size="sm"
                checked={clearApiKey}
                onCheckedChange={(checked) => {
                  setClearApiKey(checked)
                  if (checked) setApiKey('')
                }}
              />
              保存时清除已保存的 API Key
            </span>
          )}
        </label>
        <div className="grid gap-1.5 text-sm">
          <span>模型</span>
          <div className="flex items-center gap-2">
            <Select
              value={model}
              onValueChange={(value) => setModel(value as string)}
              items={modelItems}
            >
              <SelectTrigger aria-label="选择模型">
                <SelectValue placeholder="先拉取模型列表" />
              </SelectTrigger>
              <SelectContent>
                {modelOptions.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover
              open={fetchFeedback !== null}
              onOpenChange={(open) => {
                if (!open && fetchFeedback?.kind === 'failure') {
                  clearTimer(fetchTimerRef)
                  setFetchFeedback(null)
                }
              }}
            >
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={fetching || fetchFeedback?.kind === 'success'}
                    onClick={() => void fetchModels()}
                  >
                    {fetching ? '拉取中…' : '拉取模型列表'}
                  </Button>
                }
              />
              <PopoverContent side="top" align="center">
                {fetchFeedback?.kind === 'success' && (
                  <>
                    <PopoverTitle>成功</PopoverTitle>
                    <PopoverDescription>
                      {fetchFeedback.message}
                    </PopoverDescription>
                  </>
                )}
                {fetchFeedback?.kind === 'failure' && (
                  <>
                    <PopoverTitle>失败</PopoverTitle>
                    <PopoverDescription>
                      {fetchFeedback.message}
                    </PopoverDescription>
                  </>
                )}
              </PopoverContent>
            </Popover>
          </div>
          <span className="text-xs text-foreground-muted">
            填写 Base URL 与 API Key 后可自动拉取 OpenAI 兼容的 /models 列表。
          </span>
        </div>
        <label className="grid gap-1.5 text-sm">
          <span>思考等级</span>
          <Select
            value={thinking}
            onValueChange={(value) =>
              setThinking(value as ModelThinkingLevel)
            }
            items={MODEL_THINKING_LEVEL_LABELS}
          >
            <SelectTrigger aria-label="选择思考等级">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODEL_THINKING_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {MODEL_THINKING_LEVEL_LABELS[level]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-foreground-muted">
            标题命名等单次任务建议使用「关闭（最低）」或「低」，降低成本与延迟。
          </span>
        </label>
        <div className="flex items-center justify-end">
          <Popover
            open={feedback !== null}
            onOpenChange={(open) => {
              if (!open && feedback?.kind === 'failure') {
                clearTimer(feedbackTimerRef)
                setFeedback(null)
              }
            }}
          >
            <PopoverTrigger
              render={
                <Button
                  size="sm"
                  disabled={saving || feedback?.kind === 'success'}
                  onClick={() => void submit()}
                >
                  {saving ? '保存中…' : '保存'}
                </Button>
              }
            />
            <PopoverContent side="top" align="center">
              {feedback?.kind === 'success' && (
                <>
                  <PopoverTitle>成功</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
              {feedback?.kind === 'failure' && (
                <>
                  <PopoverTitle>失败</PopoverTitle>
                  <PopoverDescription>{feedback.message}</PopoverDescription>
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </Card>
  )
}

/**
 * 管理区「模型配置」：固定场景 × OpenAI 兼容模型连接
 * （baseUrl / apiKey / model / 思考等级）。场景列表由后端注册表下发，
 * 后续新增场景自动出现；apiKey 只写不回显。
 */
export function ModelConfigPage() {
  const [items, setItems] = useState<ModelScenarioConfig[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setItems(await api.listModelConfigs())
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">模型配置</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          为固定场景配置 OpenAI 兼容模型（Base URL / API Key / 模型 / 思考等级）。
          工单与根任务创建后由「工单和任务标题命名」场景异步生成「T-{'{id}'}」标题，
          失败不影响创建与流程流转。
        </p>
      </div>

      {error && <p className="mb-4 text-sm">加载失败：{error}</p>}

      <div className="grid gap-4">
        {items.map((item) => (
          <ScenarioCard key={item.scenario} config={item} onSaved={load} />
        ))}
      </div>
    </div>
  )
}

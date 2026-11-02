import { useMemo, useState } from 'react'
import { Button } from '@appica/ui-react/button'
import { Input } from '@appica/ui-react/input'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@appica/ui-react/popover'
import { ScrollArea } from '@appica/ui-react/scroll-area'
import {
  Brain,
  Check,
  ChevronsUpDown,
  Cpu,
  Loader,
  Search,
} from '@appica/icons-react'
import type {
  WorkerDebugModelCatalog,
  WorkerDebugModelSelection,
} from '../../lib/api'

interface ModelOption {
  id: string
  name: string
  variants: Array<{ id: string; name: string }>
  providerId: string
  providerName: string
}

interface ModelGroup {
  id: string
  name: string
  models: ModelOption[]
}

interface ModelSettingsPickerProps {
  catalog: WorkerDebugModelCatalog | null
  current: WorkerDebugModelSelection | null
  onChange: (input: WorkerDebugModelSelection) => Promise<void> | void
  busy?: boolean
  disabled?: boolean
  /** 触发器宽度等场景化样式（缺省 max-w-[240px]，机器人配置页传 w-full） */
  triggerClassName?: string
  /** 弹层侧向（机器人配置页在右侧面板内，默认向上弹出） */
  popoverSide?: 'top' | 'bottom' | 'left' | 'right'
}

/**
 * 模型与思考等级的合并选择器：
 * 一个入口展示当前模型与等级，弹层内支持搜索模型并按供应商分组选择。
 */
export function ModelSettingsPicker({
  catalog,
  current,
  onChange,
  busy = false,
  disabled = false,
  triggerClassName,
  popoverSide = 'top',
}: ModelSettingsPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const allModels = useMemo<ModelOption[]>(() => {
    const models =
      catalog?.providers.flatMap((provider) =>
        provider.models.map((model) => ({
          ...model,
          providerId: provider.id,
          providerName: provider.name,
        })),
      ) ?? []
    if (
      current?.modelId &&
      !models.some(
        (model) =>
          model.providerId === current.providerId &&
          model.id === current.modelId,
      )
    ) {
      models.unshift({
        id: current.modelId,
        name: current.modelId,
        variants: [],
        providerId: current.providerId,
        providerName: current.providerId,
      })
    }
    return models
  }, [catalog, current])

  const selectedModel = allModels.find(
    (model) =>
      model.providerId === current?.providerId &&
      model.id === current.modelId,
  )
  const selectedVariantName = current?.variant
    ? (selectedModel?.variants.find(
        (variant) => variant.id === current.variant,
      )?.name ?? current.variant)
    : '默认'

  const groups = useMemo<ModelGroup[]>(() => {
    const keyword = query.trim().toLocaleLowerCase()
    const result: ModelGroup[] = []
    for (const model of allModels) {
      if (
        keyword &&
        ![model.name, model.id, model.providerName].some((value) =>
          value.toLocaleLowerCase().includes(keyword),
        )
      ) {
        continue
      }
      let group = result.find((item) => item.id === model.providerId)
      if (!group) {
        group = {
          id: model.providerId,
          name: model.providerName,
          models: [],
        }
        result.push(group)
      }
      group.models.push(model)
    }
    return result
  }, [allModels, query])

  if (!current) return null

  const variants = selectedModel?.variants ?? []
  const variantOptions =
    current.variant && !variants.some((item) => item.id === current.variant)
      ? [...variants, { id: current.variant, name: current.variant }]
      : variants

  const changeModel = (model: ModelOption) => {
    if (
      model.providerId === current.providerId &&
      model.id === current.modelId
    ) {
      return
    }
    const variant =
      current.variant &&
      model.variants.some((item) => item.id === current.variant)
        ? current.variant
        : null
    void onChange({
      providerId: model.providerId,
      modelId: model.id,
      variant,
    })
  }

  const changeVariant = (variant: string | null) => {
    if ((current.variant ?? null) === variant) return
    void onChange({ ...current, variant })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        render={
          <Button
            type="button"
            size="sm"
            variant="soft"
            className={`h-8 gap-1.5 px-2.5 text-xs ${
              triggerClassName ?? 'max-w-[240px]'
            }`}
            disabled={disabled || busy || !catalog?.providers.length}
            aria-label="选择模型与思考等级"
          >
            {busy ? (
              <Loader className="size-3.5 shrink-0 animate-spin" />
            ) : (
              <Cpu className="size-3.5 shrink-0" />
            )}
            <span className="truncate">
              {selectedModel?.name ?? (current.modelId || '选择模型')}
            </span>
            <span className="shrink-0 text-foreground-subtle">
              · {selectedVariantName}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-foreground-subtle" />
          </Button>
        }
      />
      <PopoverContent
        side={popoverSide}
        align="end"
        sideOffset={6}
        arrow={false}
        className="w-[360px] max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <PopoverTitle className="sr-only">选择模型与思考等级</PopoverTitle>

        <div className="border-b border-border p-2">
          <Input
            inputSize="sm"
            variant="soft"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索模型、模型 ID 或供应商…"
            aria-label="搜索模型"
            startSlot={<Search className="size-4 text-foreground-muted" />}
            clearable
            onClear={() => setQuery('')}
          />
        </div>

        <ScrollArea className="max-h-64">
          <div className="p-1">
            {groups.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-foreground-muted">
                没有匹配的模型
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="py-1">
                  <p className="px-2 py-1 text-[11px] font-medium text-foreground-subtle">
                    {group.name}
                  </p>
                  {group.models.map((model) => {
                    const selected =
                      model.providerId === current.providerId &&
                      model.id === current.modelId
                    return (
                      <button
                        key={`${model.providerId}/${model.id}`}
                        type="button"
                        disabled={disabled || busy}
                        onClick={() => changeModel(model)}
                        className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                          selected
                            ? 'bg-background-muted font-medium text-foreground-intense'
                            : 'text-foreground-emphasis hover:bg-background-muted'
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {model.name}
                        </span>
                        {selected && (
                          <Check className="size-3.5 shrink-0 text-primary" />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </ScrollArea>

        <div className="border-t border-border p-2">
          <p className="flex items-center gap-1.5 px-1 pb-1.5 text-[11px] font-medium text-foreground-subtle">
            <Brain className="size-3.5" />
            思考等级
          </p>
          {variantOptions.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              <Button
                type="button"
                size="sm"
                variant={!current.variant ? 'soft' : 'ghost'}
                className="h-7 px-2 text-xs"
                disabled={disabled || busy}
                onClick={() => changeVariant(null)}
              >
                默认
              </Button>
              {variantOptions.map((variant) => (
                <Button
                  key={variant.id}
                  type="button"
                  size="sm"
                  variant={
                    current.variant === variant.id ? 'soft' : 'ghost'
                  }
                  className="h-7 px-2 text-xs"
                  disabled={disabled || busy}
                  onClick={() => changeVariant(variant.id)}
                >
                  {variant.name}
                </Button>
              ))}
            </div>
          ) : (
            <p className="px-1 pb-0.5 text-xs text-foreground-muted">
              当前模型无额外思考等级
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

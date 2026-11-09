import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '@appica/ui-react/badge'
import { Button } from '@appica/ui-react/button'
import { Kbd, KbdGroup } from '@appica/ui-react/kbd'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@appica/ui-react/tooltip'
import { LayoutSidebarLeftExpandFilled, Robot } from '@appica/icons-react'
import { useDetailAISlot } from './DetailAISlotContext'

/** 双栏详情页的 AI 区宽度：内容区优先，AI 区参考工作台占约 38% */
const SPLIT_GRID = 'minmax(0,1fr) minmax(360px,38%)'
const COLLAPSED_GRID = 'minmax(0,1fr) 0px'
const WIDE_QUERY = '(min-width: 1280px)'

function useWideLayout(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

interface DetailPageLayoutProps {
  /** 正文内容区 */
  children: ReactNode
  /**
   * 右侧 AI 交互区。
   * 传入时为双栏（内容 + 我的 AI），不传时为单栏（仅内容）。
   * 窄屏自动收为右下角浮动入口 + 右侧 AI 抽屉，避免压缩正文。
   */
  ai?: ReactNode
  /** 浮动入口、抽屉和收起按钮的标题；默认「我的助理」 */
  aiLabel?: string
  /** 宽屏时允许收起 AI 区，收至右下角浮动入口；窄屏始终使用浮动入口 */
  aiCollapsible?: boolean
  /** 受控展开状态；不传时由组件内部维护 */
  aiOpen?: boolean
  onAiOpenChange?: (open: boolean) => void
  /** 收起时展示的新消息数 */
  aiUnreadCount?: number
  /** 宽屏时把 AI 面板移到正文灰色画布之外，作为画布右侧的独立栏 */
  aiOutsideContent?: boolean
  /** 收起按钮定位容器类；默认适配 36px 标题栏，任务协作面板可传更高的高度 */
  aiCollapseClassName?: string
  className?: string
}

/**
 * 详情页统一布局：
 * - 双栏：内容区 + 右侧 AI 交互区；
 * - 单栏：仅内容区。
 *
 * 业务状态、历史、产物等均属于内容区，不得再占用 AI 区或新增永久第三栏。
 */
export function DetailPageLayout({
  children,
  ai,
  aiLabel = '我的助理',
  aiCollapsible = false,
  aiOpen: controlledOpen,
  onAiOpenChange,
  aiUnreadCount = 0,
  aiOutsideContent = false,
  aiCollapseClassName = 'top-0 h-9',
  className,
}: DetailPageLayoutProps) {
  const wide = useWideLayout(WIDE_QUERY)
  const aiSlot = useDetailAISlot()
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setInternalOpen(next)
      onAiOpenChange?.(next)
    },
    [controlledOpen, onAiOpenChange],
  )
  const wideOpen = !aiCollapsible || open

  useEffect(() => {
    if (wide || !open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [wide, open, setOpen])

  // ⌥/Alt+A：展开或收起 AI 面板；用 code 兼容 macOS Option+A 的死键行为。
  useEffect(() => {
    if (!ai || !aiCollapsible) return
    const handleToggleShortcut = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        event.code !== 'KeyA' ||
        !event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }
      event.preventDefault()
      setOpen(!open)
    }
    window.addEventListener('keydown', handleToggleShortcut)
    return () =>
      window.removeEventListener('keydown', handleToggleShortcut)
  }, [ai, aiCollapsible, open, setOpen])

  if (!ai) {
    return (
      <div className={`flex min-h-full min-w-0 flex-col ${className ?? ''}`}>
        {children}
      </div>
    )
  }

  if (wide && aiOutsideContent && aiSlot) {
    return (
      <>
        <div
          className={`flex h-full min-h-0 min-w-0 flex-col ${className ?? ''}`}
        >
          {children}
        </div>
        {aiSlot?.slot
          ? createPortal(
              <aside
                className={`h-full shrink-0 overflow-hidden transition-[width,margin,opacity] ${
                  wideOpen
                    ? 'w-[min(560px,34vw)] opacity-100'
                    : 'pointer-events-none -ml-3 w-0 opacity-0'
                }`}
                aria-hidden={!wideOpen}
                inert={!wideOpen}
              >
                <div className="relative flex h-full min-h-0 flex-col">
                  {aiCollapsible && wideOpen && (
                    <AICollapseButton
                      label={aiLabel}
                      shortcut={aiCollapsible}
                      className={aiCollapseClassName}
                      onCollapse={() => setOpen(false)}
                    />
                  )}
                  {ai}
                </div>
              </aside>,
              aiSlot.slot,
            )
          : null}
        {aiCollapsible && !wideOpen && (
          <AIEntry
            label={aiLabel}
            unreadCount={aiUnreadCount}
            shortcut={aiCollapsible}
            onOpen={() => setOpen(true)}
          />
        )}
      </>
    )
  }

  if (wide) {
    return (
      <>
        <div
          className={`grid h-full min-h-0 overflow-hidden transition-[grid-template-columns,gap] ${
            wideOpen ? 'gap-4' : 'gap-0'
          } ${className ?? ''}`}
          style={{
            gridTemplateColumns: wideOpen ? SPLIT_GRID : COLLAPSED_GRID,
          }}
        >
          <main className="flex min-h-0 min-w-0 flex-col">{children}</main>
          <aside
            className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden transition-opacity ${
              wideOpen ? '' : 'pointer-events-none opacity-0'
            }`}
            aria-hidden={!wideOpen}
            inert={!wideOpen}
          >
            {aiCollapsible && wideOpen && (
              <AICollapseButton
                label={aiLabel}
                shortcut={aiCollapsible}
                className={aiCollapseClassName}
                onCollapse={() => setOpen(false)}
              />
            )}
            {ai}
          </aside>
        </div>
        {aiCollapsible && !open && (
          <AIEntry
            label={aiLabel}
            unreadCount={aiUnreadCount}
            shortcut={aiCollapsible}
            onOpen={() => setOpen(true)}
          />
        )}
      </>
    )
  }

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${className ?? ''}`}>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      {/* 可收起的 AI 抽屉保持挂载，收起时仍能接收新消息并更新角标 */}
      <div
        className={`fixed inset-0 z-40 transition-opacity ${
          open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
        }`}
        aria-hidden={!open}
        inert={!open}
      >
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          className="absolute inset-0 bg-background-inverse/30 backdrop-blur-sm"
          onClick={() => setOpen(false)}
          aria-label={`关闭${aiLabel}`}
        />
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={aiLabel}
          className={`absolute inset-y-0 right-0 flex w-[min(92vw,28rem)] flex-col bg-background-muted p-2 shadow-2xl transition-transform ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="relative flex min-h-0 flex-1 flex-col">
            <AICollapseButton
              label={aiLabel}
              shortcut={aiCollapsible}
              className={aiCollapseClassName}
              onCollapse={() => setOpen(false)}
            />
            {(open || aiCollapsible) && ai}
          </div>
        </aside>
      </div>

      {!open && (
        <AIEntry
          label={aiLabel}
          unreadCount={aiUnreadCount}
          shortcut={aiCollapsible}
          onOpen={() => setOpen(true)}
        />
      )}
    </div>
  )
}

function AICollapseButton({
  label,
  shortcut,
  className,
  onCollapse,
}: {
  label: string
  shortcut: boolean
  className: string
  onCollapse: () => void
}) {
  const shortcutLabel = shortcut ? '（⌥A）' : ''
  return (
    <div className={`absolute right-3 z-10 flex items-center ${className}`}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onCollapse}
        title={`收起${label}${shortcutLabel}`}
        aria-label={`收起${label}${shortcutLabel}`}
      >
        <LayoutSidebarLeftExpandFilled className="size-4" />
      </Button>
    </div>
  )
}

function AIEntry({
  label,
  unreadCount,
  shortcut,
  onOpen,
}: {
  label: string
  unreadCount: number
  shortcut: boolean
  onOpen: () => void
}) {
  const countLabel = unreadCount > 99 ? '99+' : String(unreadCount)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="primary"
              size="icon-lg"
              className="fixed right-5 bottom-5 z-30 size-12 rounded-full shadow-lg"
              onClick={onOpen}
              aria-label={
                unreadCount > 0
                  ? `打开${label}，${unreadCount} 条新消息`
                  : `打开${label}`
              }
            >
              <Robot className="size-6" />
              {unreadCount > 0 && (
                <Badge
                  variant="error"
                  size="xs"
                  className="pointer-events-none absolute -top-1 -right-1 min-w-4 px-1 ring-2 ring-background"
                >
                  {countLabel}
                </Badge>
              )}
            </Button>
          }
        />
        <TooltipContent side="left" className="flex items-center gap-2">
          {label}
          {shortcut && (
            <KbdGroup size="sm">
              <Kbd>⌥</Kbd>
              <Kbd>A</Kbd>
            </KbdGroup>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

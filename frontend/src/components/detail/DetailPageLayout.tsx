import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@appica/ui-react/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@appica/ui-react/dialog'
import { Sparkles } from '@appica/icons-react'

/** 双栏详情页的 AI 区宽度：内容区优先，AI 区参考工作台占约 38% */
const SPLIT_GRID = 'minmax(0,1fr) minmax(360px,38%)'
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
   * 窄屏自动收为右下角浮动入口 + 全屏 AI 抽屉，避免压缩正文。
   */
  ai?: ReactNode
  /** 窄屏浮动入口与抽屉标题；默认「我的 AI」 */
  aiLabel?: string
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
  aiLabel = '我的 AI',
  className,
}: DetailPageLayoutProps) {
  const wide = useWideLayout(WIDE_QUERY)
  const [drawerOpen, setDrawerOpen] = useState(false)

  if (!ai) {
    return (
      <div className={`flex min-h-full min-w-0 flex-col ${className ?? ''}`}>
        {children}
      </div>
    )
  }

  if (wide) {
    return (
      <div
        className={`grid h-full min-h-0 gap-4 overflow-hidden ${className ?? ''}`}
        style={{ gridTemplateColumns: SPLIT_GRID }}
      >
        <main className="flex min-h-0 min-w-0 flex-col">{children}</main>
        <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          {ai}
        </aside>
      </div>
    )
  }

  return (
    <div className={`relative flex h-full min-h-0 flex-col ${className ?? ''}`}>
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      <Button
        type="button"
        variant="primary"
        className="fixed right-5 bottom-5 z-30 rounded-full shadow-lg"
        onClick={() => setDrawerOpen(true)}
      >
        <Sparkles className="size-4" />
        {aiLabel}
      </Button>
      <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DialogContent
          closeLabel="关闭 AI"
          className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{aiLabel}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawerOpen ? ai : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

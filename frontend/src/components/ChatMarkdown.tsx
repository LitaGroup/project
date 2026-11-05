import { MarkdownViewer } from './MarkdownViewer'

/** 聊天消息 Markdown 渲染（沿用任务详情页 `.task-chat-markdown` 排版） */
export function ChatMarkdown({
  text,
  onPrimary = false,
}: {
  text: string
  /** 主色气泡内使用：继承气泡文字色，保证对比度 */
  onPrimary?: boolean
}) {
  return (
    <MarkdownViewer
      text={text}
      className={onPrimary ? 'task-chat-markdown-on-primary' : undefined}
    />
  )
}

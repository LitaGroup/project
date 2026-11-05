/** 与 EventSource 对齐的最小接口，便于各页面直接替换 */
export interface VisibleEventSource {
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<string>) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

/**
 * 仅在标签页可见时保持 SSE 连接。
 *
 * 浏览器对同源 HTTP/1.1 最多 6 个并发连接，而任务详情等页面会常驻多条 SSE
 * （任务对话 + 我的 AI）。同时开几个任务/机器人标签页就会占满连接池，导致后续
 * 接口请求一直排队（典型表现：左侧任务列表已加载，右侧正文停在骨架屏）。
 *
 * 页面隐藏时断开、恢复可见时重建；服务端在订阅建立时会先推送快照，
 * 因此重连后调用方拿到的仍是最新状态。
 */
export function visibleEventSource(url: string): VisibleEventSource {
  let source: EventSource | null = null
  let closed = false

  const connection: VisibleEventSource = {
    onopen: null,
    onmessage: null,
    onerror: null,
    close() {
      closed = true
      document.removeEventListener('visibilitychange', handleVisibility)
      detach()
    },
  }

  function detach() {
    if (!source) return
    source.close()
    source = null
  }

  function attach() {
    if (closed || document.visibilityState !== 'visible') return
    const next = new EventSource(url)
    next.onopen = (event) => connection.onopen?.(event)
    next.onmessage = (event: MessageEvent<string>) =>
      connection.onmessage?.(event)
    next.onerror = (event) => connection.onerror?.(event)
    source = next
  }

  function handleVisibility() {
    if (closed) return
    if (document.visibilityState === 'visible') attach()
    else detach()
  }

  document.addEventListener('visibilitychange', handleVisibility)
  attach()
  return connection
}

import { useEffect, useRef } from 'react'

/** 运行记录中终端所需的最小字段（CheckRun/TestRun 均满足） */
type TerminalRun = {
  status: string
  output: string[] | null
}

/** 终端样式面板（Gruvbox Dark 主题，见 index.css）：原样打印脚本输出行，
    按协议类型着色，运行中自动滚到底部 */
export function Terminal({
  run,
  scriptPath,
}: {
  run: TerminalRun
  scriptPath?: string
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const lineCount = run.output?.length ?? 0

  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lineCount])

  return (
    <div
      ref={boxRef}
      className="terminal-gruvbox min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-[var(--radius-md)] p-4 font-mono text-xs leading-5"
    >
      <p>
        <span className="term-prompt">$</span>{' '}
        <span className="term-muted">node {scriptPath ?? ''}</span>
      </p>
      {(run.output ?? []).map((line, i) => (
        <p key={i} className={terminalLineClass(line)}>
          {line}
        </p>
      ))}
      {run.status === 'running' && (
        <span className="term-muted animate-pulse">▊</span>
      )}
    </div>
  )
}

/** 终端行着色（Gruvbox）：失败红、跳过黄、start/done 青、日志灰，其余默认前景色 */
function terminalLineClass(line: string): string {
  if (line.includes('"status":"fail"')) return 'term-error'
  if (line.includes('"status":"skip"')) return 'term-warning'
  if (line.startsWith('[start]') || line.startsWith('[done]')) {
    return 'term-info'
  }
  if (line.startsWith('[log]') || !line.startsWith('[')) {
    return 'term-muted'
  }
  return ''
}

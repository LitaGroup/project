/**
 * Markdown 反斜杠转义的处理。
 *
 * CommonMark 规定「反斜杠 + ASCII 标点」等价于该标点本身（`\*` 渲染为 `*`），
 * 所以这类转义在实际渲染时不产生反斜杠；但平台有些地方直接显示原文
 * （任务标题、任务对话里的用户消息按纯文本渲染），会把反斜杠一起显示出来。
 * AI 生成 Markdown 时又习惯把 URL 写成 `http\://` 以避免自动链接，
 * 因此入库前统一还原，避免标题/对话里出现 `http\://project...`。
 */

/** 还原全部反斜杠转义（用于推导纯文本标题） */
export function unescapeMarkdown(value: string): string {
  return value.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

/**
 * 只还原 URL 协议后的冒号转义（`http\://` → `http://`）。
 * 冒号在 Markdown 中没有语法含义，这种转义恒等于冒号本身，还原后正文语义不变；
 * 限定 `\://` 形态，避免改动代码块里刻意保留的反斜杠。
 */
export function unescapeMarkdownUrlColons(value: string): string {
  return value.replace(/\\:\/\//g, '://');
}

/** RAG 检索用的 Markdown 切片：按标题层级组织，再按长度切分并保留少量重叠 */

export interface KnowledgeChunk {
  index: number;
  /** 标题路径，如 "部署 / 后端 / 环境变量" */
  headingPath: string;
  /** 用于 Embedding 和检索上下文展示的正文 */
  content: string;
}

const MAX_CHUNK_CHARS = 1600;
const OVERLAP_CHARS = 180;

/** 去掉正文开头 YAML frontmatter（知识内容本身保留，仅索引时忽略） */
export function stripKnowledgeFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n') && !markdown.startsWith('---\r\n')) {
    return markdown;
  }
  const match = markdown.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
  return match ? markdown.slice(match[0].length) : markdown;
}

function splitLongText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHUNK_CHARS) return [trimmed];

  const paragraphs = trimmed.split(/\n{2,}/);
  const parts: string[] = [];
  let current = '';
  const pushCurrent = () => {
    if (current.trim()) parts.push(current.trim());
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_CHUNK_CHARS) {
      pushCurrent();
      let start = 0;
      while (start < paragraph.length) {
        parts.push(paragraph.slice(start, start + MAX_CHUNK_CHARS).trim());
        start += MAX_CHUNK_CHARS - OVERLAP_CHARS;
      }
      continue;
    }
    if (current && current.length + paragraph.length + 2 > MAX_CHUNK_CHARS) {
      pushCurrent();
    }
    current = current ? `${current}\n\n${paragraph}` : paragraph;
  }
  pushCurrent();
  return parts.filter(Boolean);
}

/**
 * 切片。标题本身会进入 headingPath，正文为对应标题下的内容；
 * 没有正文的标题不会产生空切片。
 */
export function chunkKnowledgeMarkdown(markdown: string): KnowledgeChunk[] {
  const body = stripKnowledgeFrontmatter(markdown ?? '').replace(/\r\n/g, '\n');
  if (!body.trim()) return [];

  const lines = body.split('\n');
  const headingStack: Array<{ level: number; text: string }> = [];
  const sections: Array<{ headingPath: string; text: string }> = [];
  let currentLines: string[] = [];

  const flush = () => {
    const text = currentLines.join('\n').trim();
    if (text) {
      sections.push({
        headingPath: headingStack.map((h) => h.text).join(' / '),
        text,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flush();
      const level = match[1].length;
      while (
        headingStack.length &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        headingStack.pop();
      }
      headingStack.push({ level, text: match[2].trim() });
      continue;
    }
    currentLines.push(line);
  }
  flush();

  // 全文没有标题时使用一个无名 section
  if (sections.length === 0)
    sections.push({ headingPath: '', text: body.trim() });

  const chunks: KnowledgeChunk[] = [];
  for (const section of sections) {
    for (const part of splitLongText(section.text)) {
      chunks.push({
        index: chunks.length,
        headingPath: section.headingPath,
        content: part,
      });
    }
  }
  return chunks;
}

/** Embedding 输入：带上文章标题、路径与标题层级，提升短片段召回 */
export function embeddingText(input: {
  title: string;
  path: string;
  headingPath: string;
  content: string;
}): string {
  return [
    `标题：${input.title}`,
    `路径：${input.path}`,
    input.headingPath ? `章节：${input.headingPath}` : '',
    '',
    input.content,
  ]
    .filter((line, i) => i < 3 || line !== '')
    .join('\n');
}

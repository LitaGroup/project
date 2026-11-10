import { Injectable } from '@nestjs/common';
import type { FeishuBotCardQuestion } from './feishu-bot-card.entity';
import type {
  FeishuReceiveIdType,
  FeishuSendResult,
} from './feishu-bot-client.service';
import { FeishuBotClientService } from './feishu-bot-client.service';
import type { FeishuBotSecrets } from './feishu-bot-config.entity';

/** 飞书卡片 Markdown 的单卡长度上限（保守值，飞书卡片有 30KB 限制） */
const MARKDOWN_CHUNK_LIMIT = 3600;

/** 卡片 JSON 2.0 富文本组件内最多放 4 张表格，超出需拆到下一个组件/卡片 */
const MAX_TABLES_PER_CARD = 4;

/**
 * 飞书消息组装：Markdown 回复卡片（分片）、提问卡片（选项按钮）。
 * 回复卡片使用 Card JSON 2.0 的富文本组件，支持 GFM 表格、标题、引用与行内代码；
 * 卡片 1.0 的 markdown 组件不支持表格，不要退回。
 */
@Injectable()
export class FeishuBotMessageService {
  constructor(private readonly client: FeishuBotClientService) {}

  /** 发送 Markdown 回复：超长自动分片，逐片发卡 */
  async sendMarkdown(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    markdown: string,
  ): Promise<FeishuSendResult[]> {
    const chunks = chunkMarkdown(markdown);
    const results: FeishuSendResult[] = [];
    for (const chunk of chunks) {
      results.push(
        await this.client.sendCard(
          configId,
          secrets,
          receiveIdType,
          receiveId,
          markdownCard(chunk),
        ),
      );
    }
    return results;
  }

  /**
   * 发送提问卡片：
   * - 单问题 + 有选项：加粗问题 + 选项按钮（即点即答）；
   * - 多问题组：编号列出，提示按顺序每行一个答案回复文本。
   */
  async sendQuestionCard(
    configId: number,
    secrets: FeishuBotSecrets,
    receiveIdType: FeishuReceiveIdType,
    receiveId: string,
    cardId: number,
    questionId: string,
    questions: FeishuBotCardQuestion[],
  ): Promise<FeishuSendResult> {
    const elements: Record<string, unknown>[] = [];
    if (questions.length > 1) {
      for (const [index, question] of questions.entries()) {
        elements.push({
          tag: 'markdown',
          content: `**${index + 1}. ${question.header || question.question}**\n${question.question}`,
        });
      }
      elements.push({
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content: '请按顺序每行一个答案回复文字；回复「跳过」可跳过提问',
          },
        ],
      });
    } else {
      const question = questions[0];
      elements.push({
        tag: 'markdown',
        content: `**${question.header || question.question}**`,
      });
      if (question.question !== (question.header || question.question)) {
        elements.push({ tag: 'markdown', content: question.question });
      }
      const options = question.options ?? [];
      if (options.length > 0) {
        elements.push({
          tag: 'action',
          actions: options.slice(0, 15).map((option) => ({
            tag: 'button',
            text: { tag: 'plain_text', content: option.label },
            type: 'primary',
            value: answerValue(cardId, questionId, [option.label]),
          })),
        });
        const hint: string[] = [];
        if (question.multiple) hint.push('多选可回复：选项A、选项B');
        if (question.custom !== false) hint.push('自由输入请直接回复文字');
        if (hint.length > 0) {
          elements.push({
            tag: 'note',
            elements: [{ tag: 'plain_text', content: hint.join('；') }],
          });
        }
      } else {
        elements.push({
          tag: 'note',
          elements: [{ tag: 'plain_text', content: '请直接回复文字作答' }],
        });
      }
    }
    if (questions.length === 1) {
      elements.push({ tag: 'hr' });
      elements.push({
        tag: 'note',
        elements: [
          { tag: 'plain_text', content: '回复「跳过」可跳过提问继续执行' },
        ],
      });
    }
    return this.client.sendCard(configId, secrets, receiveIdType, receiveId, {
      config: { wide_screen_mode: true },
      elements,
    });
  }
}

/**
 * 生成 Markdown 互动卡片对象（Card JSON 2.0）。
 * 2.0 富文本组件支持 GFM 表格；1.0 卡片会把表格原样输出为 pipe 文本。
 */
export function markdownCard(content: string): Record<string, unknown> {
  const chunks = splitMarkdownElements(content);
  return {
    schema: '2.0',
    config: { width_mode: 'fill', update_multi: true },
    body: {
      elements: (chunks.length > 0 ? chunks : ['']).map((chunk) => ({
        tag: 'markdown',
        content: chunk,
      })),
    },
  };
}

/** 提问按钮的 action.value（回调原样返回） */
export function answerValue(
  cardId: number,
  questionId: string,
  labels: string[],
): Record<string, unknown> {
  return { k: 'qa', c: cardId, q: questionId, a: labels };
}

/**
 * 按块切分 Markdown，用于一次回复发多张卡片：
 * 单卡不超过 MARKDOWN_CHUNK_LIMIT，表格不跨卡，单卡表格不超过 4 张。
 */
export function chunkMarkdown(content: string): string[] {
  return packMarkdownBlocks(
    splitMarkdownBlocks(content),
    MARKDOWN_CHUNK_LIMIT,
    MAX_TABLES_PER_CARD,
  );
}

/** 卡片正文元素：按块切分，保证单个富文本组件内表格不超过 4 张 */
export function splitMarkdownElements(content: string): string[] {
  return packMarkdownBlocks(
    splitMarkdownBlocks(content),
    MARKDOWN_CHUNK_LIMIT,
    MAX_TABLES_PER_CARD,
  );
}

interface MarkdownBlock {
  /** 块内容（不含块前后的空行） */
  text: string;
  /** 是否表格块：打包时受单卡表格数量上限约束，尽量整块保留 */
  table: boolean;
}

/** 去掉首尾管道后按 `|` 拆单元格（识别表格分隔行用） */
function tableCells(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|')) text = text.slice(0, -1);
  return text.split('|').map((cell) => cell.trim());
}

/** 是否 GFM 表格分隔行（| --- | :---: |） */
function isTableSeparator(line: string): boolean {
  const cells = tableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/** 当前行是否表格起点：表头行 + 分隔行 */
function isTableStart(lines: string[], index: number): boolean {
  const header = lines[index];
  const separator = lines[index + 1];
  if (!header || !separator) return false;
  return (
    header.includes('|') &&
    separator.includes('|') &&
    isTableSeparator(separator)
  );
}

/**
 * Markdown → 块列表：空行分隔的段落、围栏代码块、GFM 表格。
 * 打包分片以块为单位，避免把表格或代码块从中间切断；
 * 代码块内部的管道符不参与表格识别。
 */
export function splitMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = (content ?? '').split('\n');
  const blocks: MarkdownBlock[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text) blocks.push({ text, table: false });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      continue;
    }
    const fence = /^(`{3,}|~{3,})/.exec(line.trim());
    if (fence) {
      flush();
      const fenceLines = [line];
      const marker = fence[1];
      i += 1;
      while (i < lines.length) {
        const current = lines[i];
        fenceLines.push(current);
        i += 1;
        if (current.trim().startsWith(marker)) break;
      }
      i -= 1; // 外层循环再 +1
      blocks.push({ text: fenceLines.join('\n').trimEnd(), table: false });
      continue;
    }
    if (isTableStart(lines, i)) {
      flush();
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        tableLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      blocks.push({ text: tableLines.join('\n').trim(), table: true });
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

/**
 * 把块打包成若干片段：
 * - 单段不超过 maxLength；
 * - 单段表格数不超过 maxTables；
 * - 块之间空一行，满足飞书「表格前后需空行」的要求；
 * - 只有单块本身超长（如超大表格）才按行/硬切兜底。
 */
function packMarkdownBlocks(
  blocks: MarkdownBlock[],
  maxLength: number,
  maxTables: number,
): string[] {
  const chunks: string[] = [];
  let current = '';
  let tables = 0;

  const push = (): void => {
    const text = current.trim();
    if (text) chunks.push(text);
    current = '';
    tables = 0;
  };

  /** 超长块按行装入，单行超限时硬切 */
  const addLongText = (text: string): void => {
    for (const line of text.split('\n')) {
      if (line.length > maxLength) {
        push();
        for (let i = 0; i < line.length; i += maxLength) {
          const piece = line.slice(i, i + maxLength);
          if (piece.length === maxLength) chunks.push(piece);
          else current = piece;
        }
        continue;
      }
      if (current && current.length + 1 + line.length > maxLength) push();
      current = current ? `${current}\n${line}` : line;
    }
  };

  for (const block of blocks) {
    const nextTables = tables + (block.table ? 1 : 0);
    if (
      current &&
      (current.length + 2 + block.text.length > maxLength ||
        nextTables > maxTables)
    ) {
      push();
    }
    if (block.text.length <= maxLength) {
      current = current ? `${current}\n\n${block.text}` : block.text;
      if (block.table) tables += 1;
      continue;
    }
    addLongText(block.text);
    if (block.table) tables += 1;
  }
  push();
  return chunks;
}

/** 把用户文本按分隔符拆成候选标签（多选作答用） */
export function splitAnswerLabels(text: string): string[] {
  return text
    .split(/[、,，;；\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * 把用户文本映射为某个问题的答案：
 * - 「跳过」→ null（由调用方 reject）；
 * - 命中选项 label（完全匹配优先，其次包含匹配）→ 选项 label；
 * - 未命中且允许自由输入 → 原文；不允许自由输入 → null。
 */
export function mapTextAnswer(
  text: string,
  question: FeishuBotCardQuestion,
): string[] | null {
  const normalized = text.trim();
  if (!normalized) return null;
  const options = question.options ?? [];
  if (options.length === 0) {
    return question.custom === false ? null : [normalized];
  }
  const parts = question.multiple
    ? splitAnswerLabels(normalized)
    : [normalized];
  const labels: string[] = [];
  for (const part of parts) {
    const exact = options.find(
      (option) => option.label.toLowerCase() === part.toLowerCase(),
    );
    if (exact) {
      labels.push(exact.label);
      continue;
    }
    const partial = options.find(
      (option) =>
        option.label.toLowerCase().includes(part.toLowerCase()) ||
        part.includes(option.label),
    );
    if (partial) {
      labels.push(partial.label);
      continue;
    }
    if (question.custom === false) return null;
    labels.push(part);
  }
  return labels.length > 0 ? labels : null;
}

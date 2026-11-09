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

/**
 * 飞书消息组装：Markdown 回复卡片（分片）、提问卡片（选项按钮）。
 * 飞书 Markdown 并非完整 GFM，复杂内容（表格/Mermaid）按原样降级展示。
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

/** 生成 Markdown 互动卡片对象 */
export function markdownCard(content: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    elements: [{ tag: 'markdown', content }],
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

/** 按行边界切分 Markdown，单卡不超过 MARKDOWN_CHUNK_LIMIT */
export function chunkMarkdown(content: string): string[] {
  const text = content?.trim() ?? '';
  if (!text) return [];
  if (text.length <= MARKDOWN_CHUNK_LIMIT) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > MARKDOWN_CHUNK_LIMIT) {
      if (current) chunks.push(current);
      // 超长单行硬切
      if (line.length > MARKDOWN_CHUNK_LIMIT) {
        for (let i = 0; i < line.length; i += MARKDOWN_CHUNK_LIMIT) {
          chunks.push(line.slice(i, i + MARKDOWN_CHUNK_LIMIT));
        }
        current = '';
      } else {
        current = line;
      }
    } else {
      current = current ? `${current}\n${line}` : line;
    }
  }
  if (current) chunks.push(current);
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

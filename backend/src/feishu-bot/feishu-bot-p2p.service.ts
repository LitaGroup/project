import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { mkdir, writeFile } from 'fs/promises';
import { dirname, extname } from 'path';
import { Repository } from 'typeorm';
import { fileWebroot } from '../common/paths';
import type { User } from '../auth/user.entity';
import { WorkerRuntime } from '../common/enums';
import { Worker } from '../workers/worker.entity';
import {
  WorkerDebugService,
  type WorkerDebugAttachment,
  type DebugStreamPayload,
} from '../workers/worker-debug.service';
import { PersonalAgentsService } from '../workers/personal-agents.service';
import {
  currentRunText,
  diffRunProgress,
  initialRunState,
  interruptedResultFrom,
  pendingQuestionsOf,
  settleRunResult,
} from '../mcp/mcp-bot-runner';
import type { McpBotQuestionGroup } from '../mcp/mcp.types';
import type { FeishuBotCardQuestion } from './feishu-bot-card.entity';
import { FeishuBotCard } from './feishu-bot-card.entity';
import {
  FeishuBotClientService,
  feishuAttachmentPath,
} from './feishu-bot-client.service';
import type {
  FeishuBotConfig,
  FeishuBotSecrets,
} from './feishu-bot-config.entity';
import {
  FeishuBotMessageService,
  mapTextAnswer,
} from './feishu-bot-message.service';

/** 「正在处理」表情回应（敲键盘）；飞书表情 key 不支持时自动降级为无回应 */
export const TYPING_EMOJI = 'Typing';

/** 单轮执行最长等待（超时中断并回执） */
const RUN_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/** 飞书消息事件（已解密后的 event.message 结构子集） */
export interface FeishuInboundMessage {
  messageId: string;
  chatId: string;
  chatType: 'p2p' | 'group';
  messageType: string;
  content: string;
}

/** 进行中的一轮飞书会话 */
interface P2PRun {
  configId: number;
  userId: number;
  workerId: number;
  scope: string;
  chatId: string;
  incomingMessageId: string;
  reactionId: string | null;
  cards: Map<string, number>;
  pendingQuestion: McpBotQuestionGroup | null;
  settled: boolean;
  subscription?: { unsubscribe: () => void };
  timeout?: NodeJS.Timeout;
}

/** 飞书私聊首轮说明：说明通道与回复格式，不写入用户气泡 */
const P2P_FIRST_PROMPT = [
  '# 飞书私聊',
  '',
  '用户正在通过飞书与你一对一私聊。回复内容会以 Markdown 卡片发送到飞书，',
  '请直接回答问题，保持简洁清晰；引用文件/图片时给出平台链接即可。',
].join('\n');

/**
 * 飞书私聊桥接：
 * - 机器人绑定的独立飞书应用 → 该机器人（WorkerDebugService，scope=feishu:p2p:{chatId}）；
 * - 平台官方机器人 → 发送者的个人 AGENT（PersonalAgentsService）。
 * 收到消息先加「敲键盘」表情回应，回复以 Markdown 卡片分片发送；
 * Agent 提问转飞书卡片，卡片按钮/文本回复续跑同一轮。
 */
@Injectable()
export class FeishuBotP2PService {
  private readonly logger = new Logger(FeishuBotP2PService.name);
  /** 进行中的一轮会话：configId:chatId → run */
  private readonly runs = new Map<string, P2PRun>();

  constructor(
    private readonly client: FeishuBotClientService,
    private readonly messages: FeishuBotMessageService,
    private readonly debug: WorkerDebugService,
    private readonly personalAgents: PersonalAgentsService,
    @InjectRepository(FeishuBotCard)
    private readonly cards: Repository<FeishuBotCard>,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
  ) {}

  /** 处理一条私聊消息（已在事件层完成身份解析与去重） */
  async handleMessage(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    user: User,
    message: FeishuInboundMessage,
  ): Promise<void> {
    const receiveId = message.chatId;
    const runKey = `${config.id}:${message.chatId}`;
    const active = this.runs.get(runKey);

    // 有待回答提问时，文本/附件优先作为答案
    if (active?.pendingQuestion) {
      const { text } = await this.inboundContent(config, secrets, message, {
        skipMedia: true,
      });
      await this.answerPendingByText(config, secrets, active, text);
      return;
    }

    if (active) {
      await this.client.sendText(
        config.id,
        secrets,
        'chat_id',
        receiveId,
        '正在处理上一条消息，请稍候；回复完成后再继续。',
      );
      return;
    }

    // 服务重启后遗留的待回答提问：先恢复会话再按文本作答
    const recovered = await this.recoverPendingRun(config, message.chatId);
    if (recovered) {
      const { text } = await this.inboundContent(config, secrets, message, {
        skipMedia: true,
      });
      this.runs.set(runKey, recovered);
      await this.answerPendingByText(config, secrets, recovered, text);
      this.waitForRun(recovered, secrets, runKey);
      return;
    }

    const { text, files } = await this.inboundContent(config, secrets, message);
    if (!text && files.length === 0) {
      await this.client.sendText(
        config.id,
        secrets,
        'chat_id',
        receiveId,
        '暂时只支持文本、图片和文件消息。',
      );
      return;
    }

    // 目标机器人：官方机器人 → 个人 AGENT；绑定机器人 → 配置的 Worker
    let workerId: number;
    let firstPrompt: string | undefined;
    if (config.kind === 'official') {
      const agent = await this.personalAgents.ensureForUser(user);
      if (!agent) {
        await this.client.sendText(
          config.id,
          secrets,
          'chat_id',
          receiveId,
          '个人 AGENT 尚未就绪（需要平台配置可用的执行器与模型）；请稍后重试或在工作台检查配置。',
        );
        return;
      }
      workerId = agent.id;
    } else {
      const worker = await this.workers.findOne({
        where: { id: config.workerId ?? 0 },
      });
      if (
        !worker ||
        !worker.enabled ||
        worker.runtime !== WorkerRuntime.OPENCODE
      ) {
        await this.client.sendText(
          config.id,
          secrets,
          'chat_id',
          receiveId,
          '该机器人当前不可用（未启用或非 AI 运行时）。',
        );
        return;
      }
      workerId = worker.id;
      firstPrompt = P2P_FIRST_PROMPT;
    }

    const scope = `feishu:p2p:${message.chatId}`;
    const reaction = await this.client.react(
      config.id,
      secrets,
      message.messageId,
      typeof config.policy?.typingEmoji === 'string'
        ? config.policy.typingEmoji
        : TYPING_EMOJI,
    );

    const run: P2PRun = {
      configId: config.id,
      userId: user.id,
      workerId,
      scope,
      chatId: message.chatId,
      incomingMessageId: message.messageId,
      reactionId: reaction.reactionId,
      cards: new Map(),
      pendingQuestion: null,
      settled: false,
    };
    this.runs.set(runKey, run);

    try {
      if (config.kind === 'official') {
        await this.personalAgents.send(user, text, { scope, files });
      } else {
        await this.debug.send(user.id, workerId, text, {
          scope,
          firstPrompt,
          files,
        });
      }
    } catch (error) {
      this.runs.delete(runKey);
      if (reaction.reactionId) {
        await this.client.unreact(
          config.id,
          secrets,
          message.messageId,
          reaction.reactionId,
        );
      }
      const hint =
        error instanceof ConflictException
          ? '上一条消息仍在处理中，请稍候再发送。'
          : `消息投递失败：${(error as Error).message}`;
      await this.client.sendText(
        config.id,
        secrets,
        'chat_id',
        receiveId,
        hint,
      );
      return;
    }
    this.waitForRun(run, secrets, runKey);
  }

  /** 发送通用提示文本（身份引导/系统提示等） */
  async sendGuidance(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    chatId: string,
    text: string,
  ): Promise<void> {
    await this.client
      .sendText(config.id, secrets, 'chat_id', chatId, text)
      .catch((error: Error) => {
        this.logger.warn(`飞书提示消息发送失败: ${error.message}`);
      });
  }

  /** 卡片按钮回调：答复对应提问（事件层已解析操作者） */
  async answerByCardButton(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    cardId: number,
    labels: string[],
    operatorUserId: number,
  ): Promise<{ toast: { type: 'success' | 'error'; content: string } }> {
    const card = await this.cards.findOne({ where: { id: cardId } });
    if (!card || card.configId !== config.id) {
      return { toast: { type: 'error', content: '提问卡片不存在' } };
    }
    if (card.userId !== operatorUserId) {
      return { toast: { type: 'error', content: '无权操作该提问卡片' } };
    }
    if (card.state !== 'pending') {
      return { toast: { type: 'success', content: '该提问已处理' } };
    }
    if (card.questions.length !== 1) {
      return {
        toast: { type: 'error', content: '多问题提问请按顺序回复文字作答' },
      };
    }
    try {
      await this.debug.replyQuestion(
        card.userId,
        card.workerId,
        card.questionId,
        { answers: [labels] },
        card.scope,
      );
    } catch (error) {
      return {
        toast: {
          type: 'error',
          content: `提交失败：${(error as Error).message}`,
        },
      };
    }
    await this.cards.update({ id: card.id }, { state: 'answered' });
    const run = this.runs.get(`${config.id}:${card.chatId}`);
    if (run) run.pendingQuestion = null;
    return { toast: { type: 'success', content: '已提交' } };
  }

  // ==== 内部 ====

  /** 服务重启后恢复最近一条待回答卡片，构造可继续作答/等待终态的运行上下文 */
  private async recoverPendingRun(
    config: FeishuBotConfig,
    chatId: string,
  ): Promise<P2PRun | null> {
    const card = await this.cards.findOne({
      where: { configId: config.id, chatId, state: 'pending' },
      order: { id: 'DESC' },
    });
    if (!card) return null;
    return {
      configId: config.id,
      userId: card.userId,
      workerId: card.workerId,
      scope: card.scope,
      chatId,
      incomingMessageId: '',
      reactionId: null,
      cards: new Map([[card.questionId, card.id]]),
      pendingQuestion: {
        id: card.questionId,
        questions: card.questions.map((question) => ({
          question: question.question,
          header: question.header || question.question,
          ...(question.options?.length
            ? {
                options: question.options.map((option) => ({
                  label: option.label,
                  ...(option.description
                    ? { description: option.description }
                    : {}),
                })),
              }
            : {}),
          ...(question.multiple ? { multiple: true } : {}),
          custom: question.custom !== false,
        })),
      },
      settled: false,
    };
  }

  /** 解析入站消息：文本抽取 + 图片/文件落盘转附件 */
  private async inboundContent(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    message: FeishuInboundMessage,
    options?: { skipMedia?: boolean },
  ): Promise<{ text: string; files: WorkerDebugAttachment[] }> {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(message.content || '{}') as Record<string, unknown>;
    } catch {
      payload = {};
    }
    const files: WorkerDebugAttachment[] = [];
    let text = '';

    switch (message.messageType) {
      case 'text': {
        text = asString(payload.text)
          .replace(/@_user_\d+/g, '')
          .trim();
        break;
      }
      case 'post': {
        const segments = Array.isArray(payload.content)
          ? (payload.content as unknown[])
          : [];
        const parts: string[] = [];
        const imageKeys: string[] = [];
        for (const paragraph of segments) {
          if (!Array.isArray(paragraph)) continue;
          for (const node of paragraph as Record<string, unknown>[]) {
            if (typeof node.text === 'string') parts.push(node.text);
            if (typeof node.image_key === 'string')
              imageKeys.push(node.image_key);
          }
        }
        text = parts
          .join('')
          .replace(/@_user_\d+/g, '')
          .trim();
        if (!options?.skipMedia) {
          for (const imageKey of imageKeys) {
            if (!imageKey) continue;
            files.push(
              await this.saveImageAttachment(config, secrets, imageKey),
            );
          }
        }
        break;
      }
      case 'image': {
        if (!options?.skipMedia) {
          const imageKey = asString(payload.image_key);
          if (imageKey) {
            files.push(
              await this.saveImageAttachment(config, secrets, imageKey),
            );
          }
        }
        break;
      }
      case 'file':
      case 'media':
      case 'audio': {
        if (!options?.skipMedia) {
          const fileKey = asString(payload.file_key);
          const fileName = asString(payload.file_name) || '飞书文件';
          if (fileKey) {
            files.push(
              await this.saveFileAttachment(config, secrets, fileKey, fileName),
            );
          }
        }
        break;
      }
      default:
        break;
    }
    return { text, files };
  }

  /** 下载图片并落到平台附件目录，返回可投递的附件 */
  private async saveImageAttachment(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    imageKey: string,
  ): Promise<WorkerDebugAttachment> {
    const buffer = await this.client.downloadImage(
      config.id,
      secrets,
      imageKey,
    );
    const path = feishuAttachmentPath('.png');
    const abs = path.absPathOf(fileWebroot());
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    return {
      name: '飞书图片.png',
      url: `${this.client.appUrl}${path.publicUrl}`,
      mime: 'image/png',
      size: buffer.length,
    };
  }

  /** 下载文件并落到平台附件目录 */
  private async saveFileAttachment(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    fileKey: string,
    fileName: string,
  ): Promise<WorkerDebugAttachment> {
    const buffer = await this.client.downloadFile(config.id, secrets, fileKey);
    const safeName = fileName.replace(/[\\/\r\n]+/g, '_').slice(0, 120);
    const ext = extname(safeName).toLowerCase().slice(0, 12);
    const path = feishuAttachmentPath(ext || '.bin');
    const abs = path.absPathOf(fileWebroot());
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, buffer);
    return {
      name: safeName || '飞书文件',
      url: `${this.client.appUrl}${path.publicUrl}`,
      size: buffer.length,
    };
  }

  /** 文本作答：跳过 / 单问题映射 / 多问题按行映射 */
  private async answerPendingByText(
    config: FeishuBotConfig,
    secrets: FeishuBotSecrets,
    run: P2PRun,
    text: string,
  ): Promise<void> {
    const question = run.pendingQuestion;
    if (!question) return;
    const cardId = run.cards.get(question.id);
    const card = cardId
      ? await this.cards.findOne({ where: { id: cardId } })
      : null;
    if (!card || card.state !== 'pending') {
      run.pendingQuestion = null;
      return;
    }
    const normalized = text.trim();
    if (!normalized) {
      await this.client.sendText(
        config.id,
        secrets,
        'chat_id',
        run.chatId,
        '请输入答案，或回复「跳过」跳过提问。',
      );
      return;
    }
    try {
      if (normalized === '跳过') {
        await this.debug.replyQuestion(
          run.userId,
          run.workerId,
          question.id,
          { reject: true },
          run.scope,
        );
        await this.cards.update({ id: card.id }, { state: 'rejected' });
        run.pendingQuestion = null;
        return;
      }
      const questions = card.questions;
      let answers: string[][] | null = null;
      if (questions.length === 1) {
        const mapped = mapTextAnswer(normalized, questions[0]);
        if (!mapped) {
          await this.client.sendText(
            config.id,
            secrets,
            'chat_id',
            run.chatId,
            '无法识别答案，请点击卡片选项，或直接输入有效内容；回复「跳过」可跳过。',
          );
          return;
        }
        answers = [mapped];
      } else {
        const lines = normalized
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (lines.length !== questions.length) {
          await this.client.sendText(
            config.id,
            secrets,
            'chat_id',
            run.chatId,
            `该组提问共 ${questions.length} 个问题，请按顺序每行一个答案回复。`,
          );
          return;
        }
        const mappedLines: string[][] = [];
        for (const [index, line] of lines.entries()) {
          const mapped = mapTextAnswer(line, questions[index]);
          if (!mapped) {
            await this.client.sendText(
              config.id,
              secrets,
              'chat_id',
              run.chatId,
              `第 ${index + 1} 行无法识别为有效答案，请调整后重新回复。`,
            );
            return;
          }
          mappedLines.push(mapped);
        }
        answers = mappedLines;
      }
      await this.debug.replyQuestion(
        run.userId,
        run.workerId,
        question.id,
        { answers },
        run.scope,
      );
      await this.cards.update({ id: card.id }, { state: 'answered' });
      run.pendingQuestion = null;
    } catch (error) {
      await this.client.sendText(
        config.id,
        secrets,
        'chat_id',
        run.chatId,
        `提交答案失败：${(error as Error).message}`,
      );
    }
  }

  /**
   * 订阅会话快照等待本轮终态：
   * - 出现待回答提问 → 发飞书卡片并保持等待；
   * - 完成/出错 → Markdown 卡片回执 + 撤销处理中表情；
   * - 超时（有待回答提问则不中断，只结束本进程内的等待）。
   */
  private waitForRun(
    run: P2PRun,
    secrets: FeishuBotSecrets,
    runKey: string,
  ): void {
    const state = initialRunState();
    const sentQuestionIds = new Set<string>();
    const subscription = this.debug
      .stream(run.userId, run.workerId, run.scope)
      .subscribe({
        next: ({ data }: { data: DebugStreamPayload }) => {
          if (run.settled || data.type !== 'snapshot' || !data.snapshot) return;
          const snapshot = data.snapshot;
          const questions = pendingQuestionsOf(snapshot.messages);
          if (questions.length > 0) {
            void this.ensureQuestionCards(
              run,
              secrets,
              questions,
              sentQuestionIds,
            );
            run.pendingQuestion = questions[0];
            state.textLen = currentRunText(snapshot).length;
            return;
          }
          if (run.pendingQuestion) {
            // 提问已答复，继续跟随本轮执行
            run.pendingQuestion = null;
          }
          const step = diffRunProgress(state, snapshot);
          // 私聊不逐条回传过程文本，只等终态（过程可在平台网页查看）
          void step;
          if (snapshot.status === 'idle') {
            const settled = settleRunResult(snapshot);
            if (settled && settled.status !== 'question') {
              this.finishRun(
                run,
                secrets,
                runKey,
                settled.content,
                settled.error,
              );
            }
          }
        },
        error: (error: Error) =>
          this.finishRun(run, secrets, runKey, '', error.message),
      });

    const timeout = setTimeout(() => {
      if (run.settled) return;
      if (run.pendingQuestion) {
        // 提问等待用户作答：保留卡片，只结束本进程内的等待
        this.cleanup(run, runKey, subscription);
        return;
      }
      this.debug
        .interrupt(run.userId, run.workerId, run.scope)
        .then((snapshot) => {
          const artifacts = interruptedResultFrom(snapshot);
          this.finishRun(
            run,
            secrets,
            runKey,
            artifacts.content,
            '回复超时已中断',
          );
        })
        .catch(() =>
          this.finishRun(run, secrets, runKey, '', '回复超时且中断失败'),
        );
    }, RUN_TIMEOUT_MS);
    timeout.unref?.();
    run.subscription = subscription;
    run.timeout = timeout;
  }

  /** 出现新的待回答提问时补发卡片（幂等） */
  private async ensureQuestionCards(
    run: P2PRun,
    secrets: FeishuBotSecrets,
    groups: McpBotQuestionGroup[],
    sentQuestionIds: Set<string>,
  ): Promise<void> {
    for (const group of groups) {
      if (sentQuestionIds.has(group.id)) continue;
      sentQuestionIds.add(group.id);
      const questions: FeishuBotCardQuestion[] = group.questions.map((q) => ({
        question: q.question,
        ...(q.header ? { header: q.header } : {}),
        ...(q.options?.length
          ? { options: q.options.map((o) => ({ label: o.label })) }
          : {}),
        ...(q.multiple ? { multiple: true } : {}),
        custom: q.custom !== false,
      }));
      const card = await this.cards.save(
        this.cards.create({
          configId: run.configId,
          userId: run.userId,
          workerId: run.workerId,
          scope: run.scope,
          chatId: run.chatId,
          questionId: group.id,
          state: 'pending',
          questions,
        }),
      );
      const result = await this.messages.sendQuestionCard(
        run.configId,
        secrets,
        'chat_id',
        run.chatId,
        card.id,
        group.id,
        questions,
      );
      await this.cards.update({ id: card.id }, { messageId: result.messageId });
      run.cards.set(group.id, card.id);
    }
  }

  /** 本轮终态：发送 Markdown 回执并清理 */
  private finishRun(
    run: P2PRun,
    secrets: FeishuBotSecrets,
    runKey: string,
    content: string,
    error?: string,
  ): void {
    if (run.settled) return;
    run.settled = true;
    this.cleanup(run, runKey);
    void (async () => {
      const body = error
        ? `${content ? `${content}\n\n` : ''}⚠️ ${error}`
        : content || '（本轮没有产生回复）';
      try {
        await this.messages.sendMarkdown(
          run.configId,
          secrets,
          'chat_id',
          run.chatId,
          body,
        );
      } catch (cardError) {
        // 卡片失败降级为纯文本
        await this.client
          .sendText(
            run.configId,
            secrets,
            'chat_id',
            run.chatId,
            body.slice(0, 3000),
          )
          .catch(() => {});
        this.logger.warn(
          `飞书回复卡片发送失败（已降级文本）: ${(cardError as Error).message}`,
        );
      }
      await this.sendOutboundAttachments(run, secrets, content);
      if (run.reactionId) {
        await this.client.unreact(
          run.configId,
          secrets,
          run.incomingMessageId,
          run.reactionId,
        );
      }
    })();
  }

  /** Agent 回复中的平台图片/文件链接转飞书原生图片/文件消息（失败保留 Markdown 链接） */
  private async sendOutboundAttachments(
    run: P2PRun,
    secrets: FeishuBotSecrets,
    content: string,
  ): Promise<void> {
    const paths = Array.from(
      new Set(
        (content.match(/(?:\/images\/|\/files\/)[^\s)"'<>]+/g) ?? []).map(
          (path) => path.replace(/[.,;:]+$/, ''),
        ),
      ),
    ).slice(0, 5);
    for (const path of paths) {
      try {
        if (/\.(png|jpe?g|gif|webp)(?:$|\?)/i.test(path)) {
          const imageKey = await this.client.uploadLocalImage(
            run.configId,
            secrets,
            path,
          );
          if (imageKey) {
            await this.client.sendImage(
              run.configId,
              secrets,
              'chat_id',
              run.chatId,
              imageKey,
            );
          }
          continue;
        }
        const fileKey = await this.client.uploadLocalFile(
          run.configId,
          secrets,
          path,
        );
        if (fileKey) {
          await this.client.sendFile(
            run.configId,
            secrets,
            'chat_id',
            run.chatId,
            fileKey,
          );
        }
      } catch (error) {
        this.logger.warn(
          `飞书附件发送失败（${path}）: ${(error as Error).message}`,
        );
      }
    }
  }

  /** 退订流与定时器，并从运行表移除 */
  private cleanup(
    run: P2PRun,
    runKey: string,
    subscription?: { unsubscribe: () => void },
  ): void {
    (subscription ?? run.subscription)?.unsubscribe();
    if (run.timeout) clearTimeout(run.timeout);
    this.runs.delete(runKey);
  }
}

/** 消息字段安全转字符串（仅接受 string，避免对象被模板字符串意外序列化） */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

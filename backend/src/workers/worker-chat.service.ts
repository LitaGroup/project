import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Observable, Subscription } from 'rxjs';
import { matchesPinyinSearch } from '../common/pinyin-search';
import { Worker } from './worker.entity';
import { WorkerDebugSession } from './worker-debug-session.entity';
import {
  WorkerDebugService,
  type WorkerDebugAttachment,
  type WorkerDebugOption,
  type WorkerDebugSnapshot,
} from './worker-debug.service';

/** 顶部「机器人」一对一聊天会话范围（与机器人调试的 debug 会话隔离） */
export const WORKER_CHAT_SCOPE = 'chat';

/** 单个聊天会话的首条消息时间与机器人信息 */
export interface WorkerChatSession {
  worker: WorkerDebugOption;
  /** 会话创建时间，即该用户在该栏目向该机器人发送第一条消息的时间 */
  startedAt: string;
}

/** 会话列表最多返回的条数 */
const SESSION_LIMIT = 20;

/** 首轮对话说明：说明这是用户与机器人的一对一对话，不写入用户气泡 */
const CHAT_FIRST_PROMPT = [
  '# 机器人对话',
  '',
  '- 通道：网页（平台）',
  '- 场景：一对一对话',
  '',
  '这是用户与机器人的一对一对话。机器人的 AGENTS.md 与技能已由工作目录提供；',
  '请结合前文直接回答用户，不要复述角色设定。',
].join('\n');

/**
 * 顶部「机器人」一对一聊天：
 * - 每个「用户 + 机器人」只维护一个 chat scope 会话，复用现有唯一索引；
 * - 仅允许当前用户与可对话的公共 AI 机器人聊天；
 * - 机器人调试（debug）、我的 AI（agent:*）使用各自 scope，互不影响。
 */
@Injectable()
export class WorkerChatService {
  constructor(
    private readonly debug: WorkerDebugService,
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(WorkerDebugSession)
    private readonly sessions: Repository<WorkerDebugSession>,
  ) {}

  /** 可对话机器人：启用的 opencode 机器人；个人 AGENT 仅本人可见 */
  async listWorkers(
    userId: number,
    query?: string,
  ): Promise<WorkerDebugOption[]> {
    const options = await this.visibleWorkers(userId);
    if (!query?.trim()) return options;
    return options.filter((worker) =>
      matchesPinyinSearch(query, [worker.id, worker.name, worker.intro]),
    );
  }

  /** 当前用户已有聊天的机器人，按会话创建时间（首条消息时间）倒序，最多 20 条 */
  async listSessions(userId: number): Promise<WorkerChatSession[]> {
    const options = await this.visibleWorkers(userId);
    const byId = new Map(options.map((worker) => [worker.id, worker]));
    const rows = await this.sessions.find({
      where: { userId, contextKey: WORKER_CHAT_SCOPE },
    });
    return rows
      .flatMap((row) => {
        const worker = byId.get(row.workerId);
        if (!worker) return [];
        return [
          {
            worker,
            startedAt: row.createdAt.toISOString(),
          } satisfies WorkerChatSession,
        ];
      })
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
      )
      .slice(0, SESSION_LIMIT);
  }

  async snapshot(
    userId: number,
    workerId: number,
  ): Promise<WorkerDebugSnapshot> {
    await this.requireWorker(userId, workerId);
    return this.debug.snapshot(userId, workerId, WORKER_CHAT_SCOPE);
  }

  /** SSE 订阅前先校验可见性，避免绕过 JSON 接口直接订阅其他用户的个人 AGENT */
  stream(userId: number, workerId: number): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      let closed = false;
      let subscription: Subscription | undefined;
      void this.requireWorker(userId, workerId)
        .then(() => {
          if (closed) return;
          subscription = this.debug
            .stream(userId, workerId, WORKER_CHAT_SCOPE)
            .subscribe(subscriber);
        })
        .catch((error: Error) => {
          if (!closed) subscriber.error(error);
        });
      return () => {
        closed = true;
        subscription?.unsubscribe();
      };
    });
  }

  async send(
    userId: number,
    workerId: number,
    content: string,
    files: WorkerDebugAttachment[],
  ): Promise<WorkerDebugSnapshot> {
    await this.requireWorker(userId, workerId);
    return this.debug.send(userId, workerId, content, {
      scope: WORKER_CHAT_SCOPE,
      firstPrompt: CHAT_FIRST_PROMPT,
      files,
    });
  }

  async replyQuestion(
    userId: number,
    workerId: number,
    questionId: string,
    input: { answers?: unknown; reject?: boolean },
  ): Promise<WorkerDebugSnapshot> {
    await this.requireWorker(userId, workerId);
    return this.debug.replyQuestion(
      userId,
      workerId,
      questionId,
      input,
      WORKER_CHAT_SCOPE,
    );
  }

  async reset(userId: number, workerId: number): Promise<WorkerDebugSnapshot> {
    await this.requireWorker(userId, workerId);
    return this.debug.reset(userId, workerId, WORKER_CHAT_SCOPE);
  }

  /**
   * 可对话机器人清单：
   * - WorkerDebugService 已排除真人/停用/配置不完整/执行器离线/没有工位的机器人；
   * - 额外隐藏其他用户的个人 AGENT。
   */
  private async visibleWorkers(userId: number): Promise<WorkerDebugOption[]> {
    const options = await this.debug.listWorkers();
    if (options.length === 0) return [];
    const rows = await this.workers.find({
      where: { id: In(options.map((option) => option.id)) },
      select: { id: true, personalAgentUserId: true },
    });
    const personalOwners = new Map(
      rows.map((row) => [row.id, row.personalAgentUserId]),
    );
    return options.filter((option) => {
      const owner = personalOwners.get(option.id);
      return owner == null || owner === userId;
    });
  }

  /** 统一访问校验：不存在/不可对话/他人个人 AGENT 均拒绝 */
  private async requireWorker(
    userId: number,
    workerId: number,
  ): Promise<WorkerDebugOption> {
    const workers = await this.visibleWorkers(userId);
    const worker = workers.find((item) => item.id === workerId);
    if (worker) return worker;
    const exists = await this.workers.exists({ where: { id: workerId } });
    if (!exists) throw new NotFoundException('机器人不存在');
    throw new ServiceUnavailableException(
      '机器人当前不可对话（需启用、执行器在线且模型配置完整）',
    );
  }
}

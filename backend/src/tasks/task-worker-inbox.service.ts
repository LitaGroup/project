import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import type { Task } from './task.entity';
import {
  TaskWorkerInbox,
  type TaskWorkerInboxKind,
} from './task-worker-inbox.entity';
import { isWorkerRequester } from './task-requester';

const OPEN_STATUSES = ['pending', 'queued', 'delivered'] as const;

/** 单次扫描最多读取的开放收件箱记录（避免异常堆积拖慢 LOOP） */
const ACTIONABLE_SCAN_LIMIT = 200;

/** 父子任务机器人事件的持久化收件箱，LOOP 负责把 pending 事件排入父任务。 */
@Injectable()
export class TaskWorkerInboxService {
  constructor(
    @InjectRepository(TaskWorkerInbox)
    private readonly inbox: Repository<TaskWorkerInbox>,
  ) {}

  /** 仅机器人需求方需要收件箱；同一开放事件幂等。 */
  async enqueue(
    child: Task,
    kind: TaskWorkerInboxKind,
    options?: {
      referenceId?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<TaskWorkerInbox | null> {
    if (!isWorkerRequester(child) || !child.parentId || !child.requesterId) {
      return null;
    }
    const referenceId = options?.referenceId ?? null;
    const existing = await this.inbox.findOne({
      where: {
        childTaskId: child.id,
        kind,
        referenceId: referenceId ?? IsNull(),
        status: In([...OPEN_STATUSES]),
      },
    });
    if (existing) return existing;
    return this.inbox.save(
      this.inbox.create({
        parentTaskId: child.parentId,
        workerId: child.requesterId,
        childTaskId: child.id,
        kind,
        referenceId,
        payload: options?.payload ?? null,
        status: 'pending',
      }),
    );
  }

  listPending(take = 20): Promise<TaskWorkerInbox[]> {
    return this.inbox.find({
      where: { status: 'pending' },
      order: { id: 'ASC' },
      take,
    });
  }

  /**
   * LOOP 可处理的开放事件：pending 立即处理；queued/delivered 只在超过
   * 陈旧阈值后重新纳入，避免父机器人当前回合仍在正常消费时被重复唤醒。
   * nextRetryAt 未到的记录跳过，由退避策略防止每秒重试。
   */
  async listActionable(
    now = new Date(),
    staleMs = 60_000,
    take = 20,
  ): Promise<TaskWorkerInbox[]> {
    const rows = await this.inbox.find({
      where: { status: In([...OPEN_STATUSES]) },
      order: { id: 'ASC' },
      take: ACTIONABLE_SCAN_LIMIT,
    });
    const staleBefore = now.getTime() - staleMs;
    return rows
      .filter((row) => {
        const retryAt = row.nextRetryAt
          ? new Date(row.nextRetryAt).getTime()
          : 0;
        if (retryAt > now.getTime()) return false;
        if (row.status === 'pending') return true;
        const updatedAt = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
        return !Number.isFinite(updatedAt) || updatedAt <= staleBefore;
      })
      .slice(0, take);
  }

  /** 重新打开陈旧事件；仅当仍处于开放状态时生效，避免覆盖并发完成。 */
  async reopen(id: number, reason: string): Promise<boolean> {
    const now = new Date();
    const result = await this.inbox.update(
      { id, status: In([...OPEN_STATUSES]) },
      {
        status: 'pending',
        deliveredAt: null,
        nextRetryAt: null,
        attempts: () => '"attempts" + 1',
        lastAttemptAt: now,
        lastError: reason,
      },
    );
    return Boolean(result.affected);
  }

  /** 暂缓处理并记录一次失败尝试；达到阈值后由 LOOP 转人工。 */
  async defer(id: number, nextRetryAt: Date, reason: string): Promise<void> {
    await this.inbox.update(
      { id, status: In([...OPEN_STATUSES]) },
      {
        nextRetryAt,
        attempts: () => '"attempts" + 1',
        lastAttemptAt: new Date(),
        lastError: reason,
      },
    );
  }

  async markDone(id: number): Promise<void> {
    await this.inbox.update(
      { id, status: In([...OPEN_STATUSES]) },
      { status: 'done', processedAt: new Date() },
    );
  }

  async markQueued(id: number): Promise<void> {
    await this.inbox.update(
      { id, status: 'pending' },
      { status: 'queued', nextRetryAt: null },
    );
  }

  async markDelivered(parentTaskId: number): Promise<void> {
    await this.inbox.update(
      { parentTaskId, status: 'queued' },
      {
        status: 'delivered',
        deliveredAt: new Date(),
        nextRetryAt: null,
      },
    );
  }

  /**
   * 父会话结束但未处理的事件：提问/验收/消息需要显式动作，重新排队；
   * 拒绝/取消提醒不要求固定动作，直接视为处理完成。
   * 同时覆盖 queued（已写入 resumePrompt 但尚未投递）与 delivered（已投递但会话异常结束），
   * 避免会话失败、人工中断或进程重启后事件永久滞留。
   */
  async requeueDelivered(parentTaskId: number): Promise<void> {
    await this.inbox.update(
      {
        parentTaskId,
        kind: In(['question', 'handoff', 'message']),
        status: In(['queued', 'delivered']),
      },
      {
        status: 'pending',
        deliveredAt: null,
        nextRetryAt: null,
        attempts: () => '"attempts" + 1',
        lastAttemptAt: new Date(),
        lastError: '父机器人本轮已结束，但事件尚未通过动作接口处理',
      },
    );
    await this.inbox.update(
      {
        parentTaskId,
        kind: In(['refused', 'cancelled']),
        status: In(['queued', 'delivered']),
      },
      { status: 'done', processedAt: new Date() },
    );
  }

  async completeForChild(
    childTaskId: number,
    kind?: TaskWorkerInboxKind,
    referenceId?: string,
  ): Promise<void> {
    await this.inbox.update(
      {
        childTaskId,
        ...(kind ? { kind } : {}),
        ...(referenceId ? { referenceId } : {}),
        status: In([...OPEN_STATUSES]),
      },
      { status: 'done', processedAt: new Date() },
    );
  }

  /**
   * 需求方回复消息后完成「已投递」的消息事件。
   * 父机器人处理期间新到的 pending 消息保留，等待下一轮唤醒再回复。
   */
  async completeDeliveredForChild(
    childTaskId: number,
    kind: TaskWorkerInboxKind,
  ): Promise<void> {
    await this.inbox.update(
      { childTaskId, kind, status: In(['queued', 'delivered']) },
      { status: 'done', processedAt: new Date() },
    );
  }

  async markDead(id: number): Promise<void> {
    await this.inbox.update(
      { id, status: In([...OPEN_STATUSES]) },
      { status: 'dead', processedAt: new Date() },
    );
  }

  async deleteForTasks(taskIds: number[]): Promise<void> {
    if (taskIds.length === 0) return;
    await this.inbox.delete([
      { parentTaskId: In(taskIds) },
      { childTaskId: In(taskIds) },
    ]);
  }
}

function payloadText(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (!value || typeof value !== 'object') return null;
  const option = value as Record<string, unknown>;
  const label =
    typeof option.label === 'string' && option.label.trim()
      ? option.label.trim()
      : null;
  if (!label) return null;
  const description =
    typeof option.description === 'string' && option.description.trim()
      ? option.description.trim()
      : null;
  return description ? `${label}（${description}）` : label;
}

/** 收件箱 payload 里的问题正文转成父机器人可直接阅读的清单。 */
function questionPromptLines(questions: unknown): string[] {
  if (!Array.isArray(questions)) return [];
  const lines: string[] = [];
  questions.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const question = item as Record<string, unknown>;
    const header =
      typeof question.header === 'string' ? question.header.trim() : '';
    const content =
      typeof question.question === 'string' ? question.question.trim() : '';
    const options = Array.isArray(question.options)
      ? question.options
          .map(optionText)
          .filter((option): option is string => Boolean(option))
      : [];
    lines.push(
      `${index + 1}. ${header || `问题 ${index + 1}`}`,
      `   - 内容：${content || '（见子任务详情）'}`,
      `   - 选项：${options.join(' / ') || '无'}`,
      `   - 回答方式：${question.multiple === true ? '多选' : '单选'}；${
        question.custom === false ? '仅限选项' : '允许自由输入'
      }`,
    );
  });
  return lines;
}

/** 发给父任务机器人的结构化事件说明。 */
export function taskInboxPrompt(
  entry: TaskWorkerInbox,
  child: Task,
  apiUrl = '/api',
): string {
  const payload = entry.payload ?? {};
  const base = apiUrl.trim().replace(/\/+$/, '') || '/api';
  const endpoint = (path: string): string => `${base}${path}`;
  const handoffUrl = payloadText(payload, 'handoffUrl');
  const acceptUrl = endpoint(`/tasks/${child.id}/handoff/accept.md`);
  const refuseUrl = endpoint(`/tasks/${child.id}/handoff/refuse.md`);
  const failUrl = endpoint(`/tasks/${child.id}/fail.md`);
  const detailUrl = endpoint(`/tasks/${child.id}.md`);
  const handoffReadUrl = endpoint(`/tasks/${child.id}/handoff.md`);
  const replyUrl = endpoint(`/tasks/${child.id}/messages/reply.md`);
  const answerUrl = endpoint(
    `/tasks/${child.id}/questions/${encodeURIComponent(
      entry.referenceId ?? '',
    )}/answer.md`,
  );
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  const questionLines = questionPromptLines(questions);
  const answerExample = JSON.stringify({
    answers: Array.from({ length: Math.max(questions.length, 1) }, () => [
      '答案',
    ]),
  });

  const action =
    entry.kind === 'question'
      ? [
          '请先读取子任务详情并回答下方问题，处理后必须调用答复接口；只回复消息不会解除子任务的待反馈状态。',
          `- 子任务详情：GET ${detailUrl}`,
          '',
          '**待回答问题**',
          '',
          ...(questionLines.length
            ? questionLines
            : ['事件未携带问题正文，请先读取子任务详情。']),
          '',
          '```bash',
          'TOKEN=$(cat .opencode/agent-token)',
          `curl -sS -X POST '${answerUrl}' \\`,
          '  -H "X-Worker-Token: $TOKEN" \\',
          '  -H "Content-Type: application/json" \\',
          `  -d '${answerExample}'`,
          '```',
          '',
          '`answers` 外层长度必须与问题数量一致，每个问题的答案放在对应内层数组。',
          '多选可填写多个选项 label；仅限选项时必须使用给定 label；无法回答时可传 `{"reject":true}` 跳过。',
        ].join('\n')
      : entry.kind === 'handoff'
        ? [
            '请先读取子任务交付文档并检查交付物，处理后必须调用以下接口之一（不能只回复消息）：',
            `- 交付文档：GET ${handoffReadUrl}`,
            ...(handoffUrl ? [`- 文档查看地址：${handoffUrl}`] : []),
            '',
            '```bash',
            'TOKEN=$(cat .opencode/agent-token)',
            '# 验收通过',
            `curl -sS -X POST '${acceptUrl}' \\`,
            '  -H "X-Worker-Token: $TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            "  -d '{}'",
            '',
            '# 返工（content 必填）',
            `curl -sS -X POST '${refuseUrl}' \\`,
            '  -H "X-Worker-Token: $TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"content":"具体返工原因"}\'',
            '',
            '# 判定失败（reason 必填）',
            `curl -sS -X POST '${failUrl}' \\`,
            '  -H "X-Worker-Token: $TOKEN" \\',
            '  -H "Content-Type: application/json" \\',
            '  -d \'{"reason":"失败原因"}\'',
            '```',
            '',
            '验收前必须确认交付物满足子任务输出要求；通过后该子任务即结束。',
          ].join('\n')
        : entry.kind === 'message'
          ? [
              '子任务执行方发来一条消息，请以需求方身份阅读并回复。处理后必须调用回复接口（不能只回复本条提示）：',
              `- 子任务详情：GET ${detailUrl}`,
              '',
              '**消息正文**',
              '',
              payloadText(payload, 'content') ??
                '（事件未携带消息正文，请先读取子任务详情与对话记录。）',
              '',
              '```bash',
              'TOKEN=$(cat .opencode/agent-token)',
              `curl -sS -X POST '${replyUrl}' \\`,
              '  -H "X-Worker-Token: $TOKEN" \\',
              '  -H "Content-Type: application/json" \\',
              `  -d '{"content":"回复内容"}'`,
              '```',
              '',
              '回复会立即出现在子任务对话中供执行方继续跟进；如无需补充，也要说明处理结论。',
            ].join('\n')
          : entry.kind === 'refused'
            ? `子机器人拒绝承接。理由：${child.refusalReason ?? '未填写'}；分发建议：${child.dispatchSuggestion ?? '无'}。请决定是否创建新的子任务。`
            : '子任务已取消，请评估对父任务的影响并继续处理。';
  return [
    '# 子任务协同事件',
    '',
    `- 子任务：${child.code} ${child.title}（ID=${child.id}）`,
    `- 状态：${child.status}-${child.subStatus}`,
    `- 事件：${entry.kind}`,
    `- 事件收件箱 ID：${entry.id}`,
    '',
    action,
    '',
    '处理完该事件后再推进当前父任务；不要代替子任务执行机器人调用接受、提问或验收申请接口。',
  ].join('\n');
}

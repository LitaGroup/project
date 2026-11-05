import { ForbiddenException } from '@nestjs/common';
import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import type { Task } from './task.entity';
import {
  assertTaskRequester,
  isTaskRequester,
  workerRequesterActor,
} from './task-requester';

const HUMAN_WORKER_ID = 1001;
const PERSONAL_AGENT_ID = 1002;
const OTHER_WORKER_ID = 1003;
const USER_ID = 8;

function worker(over: Partial<Worker> = {}): Worker {
  return {
    id: HUMAN_WORKER_ID,
    name: '张三',
    humanUserId: USER_ID,
    ...over,
  } as Worker;
}

function personalAgent(over: Partial<Worker> = {}): Worker {
  return {
    id: PERSONAL_AGENT_ID,
    name: '张三的 AI',
    personalAgentUserId: USER_ID,
    ...over,
  } as Worker;
}

function user(over: Partial<User> = {}): User {
  return { id: USER_ID, name: '张三', ...over } as User;
}

function task(over: Partial<Task> = {}): Task {
  return {
    id: 51,
    requesterType: 'worker',
    requesterId: HUMAN_WORKER_ID,
    createdById: USER_ID,
    ...over,
  } as Task;
}

describe('TaskActor 需求方身份校验', () => {
  it('真人机器人是任务需求方时直接通过', () => {
    const actor = workerRequesterActor(worker());

    expect(isTaskRequester(task(), actor)).toBe(true);
    expect(() => assertTaskRequester(task(), actor)).not.toThrow();
  });

  it('历史个人 AGENT 需求方由同一账号的真人机器人操作时通过', () => {
    const actor = workerRequesterActor(worker(), personalAgent());

    expect(
      isTaskRequester(task({ requesterId: PERSONAL_AGENT_ID }), actor),
    ).toBe(true);
    expect(() =>
      assertTaskRequester(task({ requesterId: PERSONAL_AGENT_ID }), actor),
    ).not.toThrow();
  });

  it('其他账号的机器人不能借用历史需求方别名', () => {
    const actor = workerRequesterActor(
      worker({
        id: OTHER_WORKER_ID,
        name: '其他机器人',
        humanUserId: 9,
      }),
      personalAgent(),
    );

    expect(() =>
      assertTaskRequester(task({ requesterId: PERSONAL_AGENT_ID }), actor),
    ).toThrow(ForbiddenException);
  });

  it('用户身份不能匹配机器人需求方', () => {
    const actor = { type: 'user' as const, user: user() };

    expect(
      isTaskRequester(task({ requesterId: PERSONAL_AGENT_ID }), actor),
    ).toBe(false);
  });

  it('历史无需求方类型的任务仍按创建人校验', () => {
    expect(
      isTaskRequester(task({ requesterType: null, requesterId: null }), {
        type: 'user',
        user: user(),
      }),
    ).toBe(true);
    expect(
      isTaskRequester(
        task({ requesterType: null, requesterId: null }),
        workerRequesterActor(worker()),
      ),
    ).toBe(false);
  });
});

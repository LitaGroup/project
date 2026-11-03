import { deriveWorkbenchRoles } from './workbench-roles';

const HUMAN_WORKER_ID = 1035;
const PERSONAL_AGENT_ID = 1036;
const OWNED_WORKER_ID = 1003;
const USER_ID = 1;

function task(patch: Partial<Parameters<typeof deriveWorkbenchRoles>[0]>) {
  return {
    agentId: null,
    requesterType: null,
    requesterId: null,
    createdById: null,
    ownerTakeoverUserId: null,
    ...patch,
  };
}

function roles(patch: Partial<Parameters<typeof deriveWorkbenchRoles>[0]>) {
  return deriveWorkbenchRoles(
    task(patch),
    { id: USER_ID },
    {
      humanWorker: { id: HUMAN_WORKER_ID },
      personalAgentId: PERSONAL_AGENT_ID,
      ownedWorkerIds: [OWNED_WORKER_ID],
    },
  );
}

describe('deriveWorkbenchRoles', () => {
  it('我是需求方且执行机器人是我名下的，只保留需求方（不再显示执行方 TAB）', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: USER_ID,
        agentId: OWNED_WORKER_ID,
      }),
    ).toEqual(['requester']);
  });

  it('我名下的机器人执行、我不是需求方时，标记为负责人', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: 2,
        agentId: OWNED_WORKER_ID,
      }),
    ).toEqual(['responsible']);
  });

  it('我的真人机器人执行时标记为我执行', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: 2,
        agentId: HUMAN_WORKER_ID,
      }),
    ).toEqual(['agent']);
  });

  it('历史任务需求方是个人 AGENT 时仍识别为需求方', () => {
    expect(
      roles({
        requesterType: 'worker',
        requesterId: PERSONAL_AGENT_ID,
      }),
    ).toEqual(['requester']);
  });

  it('个人 AGENT 不再作为执行方产生角色', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: 2,
        agentId: PERSONAL_AGENT_ID,
      }),
    ).toEqual([]);
  });

  it('验收升级接管且我不是需求方时标记为负责人', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: 2,
        agentId: 2000,
        ownerTakeoverUserId: USER_ID,
      }),
    ).toEqual(['responsible']);
  });

  it('历史任务没有 requesterType 时按创建人识别需求方', () => {
    expect(roles({ agentId: OWNED_WORKER_ID, createdById: USER_ID })).toEqual([
      'requester',
    ]);
  });

  it('与任务无关时没有任何角色', () => {
    expect(
      roles({
        requesterType: 'user',
        requesterId: 2,
        agentId: 2000,
        ownerTakeoverUserId: null,
      }),
    ).toEqual([]);
  });
});

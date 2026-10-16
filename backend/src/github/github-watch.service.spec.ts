import { Subject } from 'rxjs';
import type { Repository } from 'typeorm';
import { GithubService } from './github.service';
import { CodeEventPayload, GithubWatchService } from './github-watch.service';
import { CodeEvent } from './code-event.entity';
import { ProjectBranch } from './project-branch.entity';

interface FakeDeps {
  /** 已登记的 仓库+分支（可含重复，模拟多项目登记同一分支） */
  registered: Partial<ProjectBranch>[];
  /** 库内已记录的 (repo, branch, sha) */
  existing: { repo: string; branch: string; sha: string }[];
  /** GitHub 返回的最近提交 */
  commits: {
    sha: string;
    message: string;
    author: string;
    isMerge: boolean;
    url: string;
    committedAt: Date;
  }[];
  tokenConfigured?: boolean;
  /** listCommits 抛错（模拟网络失败） */
  failListCommits?: boolean;
}

function commit(sha: string) {
  return {
    sha,
    message: `commit ${sha}`,
    author: 'hufeng',
    isMerge: false,
    url: `https://github.com/LitaGroup/project/commit/${sha}`,
    committedAt: new Date('2026-10-16T03:00:00Z'),
  };
}

function createWatch(deps: FakeDeps) {
  const inserted: Record<string, unknown>[] = [];
  const branchesRepo = {
    find: () => Promise.resolve(deps.registered),
  } as unknown as Repository<ProjectBranch>;

  const eventsRepo = {
    find: (opts?: { select?: { sha?: boolean } }) => {
      // select: {sha: true} → 判重查询；否则为插入后的回读（返回已保存行含新插入的，service 端按 sha 取）
      if (opts?.select?.sha) return Promise.resolve(deps.existing);
      return Promise.resolve(
        [...deps.existing, ...inserted].map((e, i) => ({
          id: i + 1,
          ...e,
        })),
      );
    },
    create: (value: Record<string, unknown>) => value,
    createQueryBuilder: () => {
      const builder = {
        insert: () => builder,
        into: () => builder,
        values: (vs: Record<string, unknown>[]) => {
          inserted.push(...vs);
          return builder;
        },
        orIgnore: () => builder,
        execute: () => Promise.resolve({}),
      };
      return builder;
    },
  } as unknown as Repository<CodeEvent>;

  const listCommits = jest.fn(() => {
    if (deps.failListCommits) return Promise.reject(new Error('boom'));
    return Promise.resolve(deps.commits);
  });
  const github = {
    tokenConfigured: deps.tokenConfigured ?? true,
    listCommits,
  } as unknown as GithubService;

  const emitted: CodeEventPayload[] = [];
  const bus = new Subject<CodeEventPayload>();
  bus.subscribe((p) => emitted.push(p));

  const watch = new GithubWatchService(branchesRepo, eventsRepo, github, bus);
  return { watch, inserted, emitted, listCommits };
}

describe('GithubWatchService.pollOnce（监听轮询）', () => {
  it('未配置 token 时直接跳过，不发起任何请求', async () => {
    const { watch, listCommits, emitted } = createWatch({
      registered: [],
      existing: [],
      commits: [],
      tokenConfigured: false,
    });
    await watch.pollOnce('测试');
    expect(listCommits).not.toHaveBeenCalled();
    expect(emitted).toHaveLength(0);
  });

  it('多项目登记同一 仓库+分支 时去重为单个监听目标', async () => {
    const target = { repo: 'LitaGroup/project', branch: 'main' };
    const { watch, listCommits, inserted } = createWatch({
      registered: [
        { ...target, projectId: 1 },
        { ...target, projectId: 2 },
      ],
      existing: [],
      commits: [commit('a1'), commit('a2')],
    });
    await watch.pollOnce('测试');
    expect(listCommits).toHaveBeenCalledTimes(1);
    expect(listCommits).toHaveBeenCalledWith('LitaGroup/project', 'main', 20);
    expect(inserted).toHaveLength(2);
  });

  it('首次见到的目标全量入库（基线），事件标记 baseline=true', async () => {
    const { watch, inserted, emitted } = createWatch({
      registered: [{ repo: 'LitaGroup/project', branch: 'main', projectId: 1 }],
      existing: [],
      commits: [commit('a1'), commit('a2'), commit('a3')],
    });
    await watch.pollOnce('测试');
    expect(inserted).toHaveLength(3);
    expect(emitted).toHaveLength(3);
    expect(emitted.every((p) => p.baseline)).toBe(true);
    expect(emitted.map((p) => p.event.sha)).toEqual(['a1', 'a2', 'a3']);
  });

  it('已有记录时仅插入新增 sha，事件标记 baseline=false', async () => {
    const { watch, inserted, emitted } = createWatch({
      registered: [{ repo: 'LitaGroup/project', branch: 'main', projectId: 1 }],
      existing: [
        { repo: 'LitaGroup/project', branch: 'main', sha: 'a2' },
        { repo: 'LitaGroup/project', branch: 'main', sha: 'a3' },
      ],
      commits: [commit('a1'), commit('a2'), commit('a3')],
    });
    await watch.pollOnce('测试');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]['sha']).toBe('a1');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].baseline).toBe(false);
  });

  it('全部 sha 已记录时不插入不广播', async () => {
    const { watch, inserted, emitted } = createWatch({
      registered: [{ repo: 'LitaGroup/project', branch: 'main', projectId: 1 }],
      existing: [
        { repo: 'LitaGroup/project', branch: 'main', sha: 'a1' },
        { repo: 'LitaGroup/project', branch: 'main', sha: 'a2' },
      ],
      commits: [commit('a1'), commit('a2')],
    });
    await watch.pollOnce('测试');
    expect(inserted).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  it('单个目标拉取失败不影响其余目标', async () => {
    const { watch, listCommits, emitted } = createWatch({
      registered: [
        { repo: 'LitaGroup/project', branch: 'main', projectId: 1 },
        { repo: 'LitaGroup/lita-android', branch: 'test', projectId: 1 },
      ],
      existing: [],
      commits: [commit('a1')],
      failListCommits: true,
    });
    // listCommits 固定抛错：两个目标都失败但不向上抛
    await expect(watch.pollOnce('测试')).resolves.toBeUndefined();
    expect(listCommits).toHaveBeenCalledTimes(2);
    expect(emitted).toHaveLength(0);
  });

  it('GitHub 返回空提交列表时静默跳过', async () => {
    const { watch, inserted, emitted } = createWatch({
      registered: [{ repo: 'LitaGroup/project', branch: 'main', projectId: 1 }],
      existing: [],
      commits: [],
    });
    await watch.pollOnce('测试');
    expect(inserted).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });
});

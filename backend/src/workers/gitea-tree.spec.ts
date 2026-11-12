import { fetchFullTree, GiteaTreeEntry } from './gitea-tree';

describe('fetchFullTree', () => {
  const apiRepo = 'http://gitea.example.com/api/v1/repos/team/skills';

  it('按 truncated 逐页拉取并合并全部条目', async () => {
    const urls: string[] = [];
    const pages: Record<number, GiteaTreeEntry[]> = {
      1: [
        { path: 'a/one.md', type: 'blob' },
        { path: 'a/two.md', type: 'blob' },
      ],
      2: [{ path: 'b/three.md', type: 'blob' }],
    };
    const tree = await fetchFullTree(
      (url) => {
        urls.push(url);
        const page = Number(new URL(url).searchParams.get('page'));
        return Promise.resolve({
          tree: pages[page] ?? [],
          truncated: page < 2,
          page,
          total_count: 3,
        });
      },
      apiRepo,
      'main',
    );
    expect(tree.map((item) => item.path)).toEqual([
      'a/one.md',
      'a/two.md',
      'b/three.md',
    ]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('recursive=true');
    expect(urls[0]).toContain('per_page=1000');
    expect(urls[0]).toContain('page=1');
    expect(urls[1]).toContain('page=2');
  });

  it('兼容不返回 truncated 的旧版本：空页时停止', async () => {
    let calls = 0;
    const tree = await fetchFullTree(
      () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? { tree: [{ path: 'only.md', type: 'blob' }] }
            : { tree: [] },
        );
      },
      apiRepo,
      'main',
    );
    expect(tree.map((item) => item.path)).toEqual(['only.md']);
    expect(calls).toBe(2);
  });

  it('按 path 去重，重复分页不会产生重复条目', async () => {
    const tree = await fetchFullTree(
      (url) => {
        const page = Number(new URL(url).searchParams.get('page'));
        return Promise.resolve({
          tree: [{ path: 'same.md', type: 'blob' }],
          truncated: page < 2,
        });
      },
      apiRepo,
      'main',
    );
    expect(tree).toHaveLength(1);
  });

  it('异常仓库始终 truncated 时在页数上限处停止', async () => {
    let calls = 0;
    const tree = await fetchFullTree(
      () => {
        calls += 1;
        return Promise.resolve({
          tree: [{ path: `p${calls}.md`, type: 'blob' }],
          truncated: true,
        });
      },
      apiRepo,
      'main',
    );
    expect(calls).toBe(100);
    expect(tree).toHaveLength(100);
  });
});

import { Logger } from '@nestjs/common';

/** Gitea 仓库树条目（仅取用到的字段） */
export interface GiteaTreeEntry {
  path?: string;
  type?: string;
}

interface GiteaTreeResponse {
  tree?: GiteaTreeEntry[];
  /** 是否还有后续分页；false 表示已到末页 */
  truncated?: boolean;
  page?: number;
  total_count?: number;
}

/** Gitea 单页最多返回的目录树条目数 */
const TREE_PAGE_SIZE = 1000;
/** 分页上限（10 万条），超过视为仓库异常，避免无限请求 */
const TREE_MAX_PAGES = 100;

const logger = new Logger('GiteaTree');

/**
 * 分页拉取 Gitea 递归目录树。
 * `git/trees?recursive=true` 单页最多 1000 条，且仓库较大时返回 truncated=true；
 * 只读第 1 页会静默漏掉按路径排序靠后的全部文件。
 * requestJson 由调用方提供，沿用各自的超时与错误包装。
 */
export async function fetchFullTree(
  requestJson: (url: string) => Promise<unknown>,
  apiRepo: string,
  branch: string,
): Promise<GiteaTreeEntry[]> {
  const base = `${apiRepo}/git/trees/${encodeURIComponent(
    branch,
  )}?recursive=true&per_page=${TREE_PAGE_SIZE}`;
  const byPath = new Map<string, GiteaTreeEntry>();
  for (let page = 1; page <= TREE_MAX_PAGES; page += 1) {
    const result = (await requestJson(
      `${base}&page=${page}`,
    )) as GiteaTreeResponse | null;
    const entries = Array.isArray(result?.tree) ? result.tree : [];
    for (const entry of entries) {
      if (entry.path) byPath.set(entry.path, entry);
    }
    // truncated=false 是末页的权威信号；空页兼容不返回该字段的旧版本
    if (result?.truncated === false || entries.length === 0) {
      return [...byPath.values()];
    }
  }
  logger.warn(
    `目录树超过 ${TREE_MAX_PAGES} 页，结果可能不完整：${apiRepo}@${branch}`,
  );
  return [...byPath.values()];
}

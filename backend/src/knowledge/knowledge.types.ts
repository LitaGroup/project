export type KnowledgeNodeKind = 'directory' | 'article';
export type KnowledgeNodeSource = 'native' | 'project-document' | 'system';
export type KnowledgeIndexStatus = 'pending' | 'ready' | 'error';
export type KnowledgeSearchSource = 'project' | 'feishu' | 'all';

export interface KnowledgeNode {
  id: string;
  kind: KnowledgeNodeKind;
  path: string;
  parentPath: string;
  name: string;
  title: string;
  content: string | null;
  source: KnowledgeNodeSource;
  sourceDocumentId: number | null;
  contentHash: string;
  indexStatus: KnowledgeIndexStatus;
  indexError: string | null;
  indexAttempts: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 目录列表中的条目：不带正文 */
export type KnowledgeNodeSummary = Omit<
  KnowledgeNode,
  'content' | 'contentHash' | 'indexError' | 'indexAttempts'
>;

export interface KnowledgeDirectory {
  path: string;
  title: string;
  parentPath: string | null;
  directories: KnowledgeNodeSummary[];
  articles: KnowledgeNodeSummary[];
}

export interface KnowledgeSearchResult {
  nodeId: string;
  title: string;
  path: string;
  headingPath: string;
  content: string;
  score: number;
  matchedBy: 'vector' | 'fulltext' | 'hybrid';
  updatedAt: Date;
}

export interface KnowledgeRetrieval {
  query: string;
  path: string;
  mode: 'hybrid' | 'fulltext';
  results: KnowledgeSearchResult[];
  hasMore: boolean;
}

export interface KnowledgeProjectSearchPage {
  page: number;
  pageSize: number;
  hasMore: boolean;
  mode: 'hybrid' | 'fulltext';
  results: KnowledgeSearchResult[];
  /** source=all 时站内知识库不可用只标记该源，不影响飞书结果 */
  error?: string;
}

export interface KnowledgeFeishuResult {
  token: string;
  title: string;
  url: string | null;
  docsType: string;
  entityType: string;
  summary: string;
  ownerName: string | null;
  ownerId: string | null;
  updateTime: number | null;
  createTime: number | null;
  /** 转换为 Markdown 的外部接口地址 */
  markdownUrl: string | null;
}

export interface KnowledgeFeishuSearchPage {
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number;
  results: KnowledgeFeishuResult[];
  /** source=all 时飞书搜索失败只标记该源，不影响站内结果 */
  error?: string;
}

export interface KnowledgeSearchResponse {
  query: string;
  source: KnowledgeSearchSource;
  path: string;
  page: number;
  pageSize: number;
  /** 兼容旧字段：站内检索模式 */
  mode: 'hybrid' | 'fulltext';
  /** 兼容旧字段：站内检索结果（source=feishu 时为空） */
  results: KnowledgeSearchResult[];
  project?: KnowledgeProjectSearchPage;
  feishu?: KnowledgeFeishuSearchPage;
}

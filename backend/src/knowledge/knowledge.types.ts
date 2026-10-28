export type KnowledgeNodeKind = 'directory' | 'article';
export type KnowledgeNodeSource = 'native' | 'project-document' | 'system';
export type KnowledgeIndexStatus = 'pending' | 'ready' | 'error';
/** 搜索数据源：仅站内知识（飞书云文档搜索已下线） */
export type KnowledgeSearchSource = 'project';

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
  /** RRF 原始分（仅用于诊断，跨来源排序使用 relevance） */
  score: number;
  /** 归一化相关度（0..1），用于文档与脚本等不同来源统一排序 */
  relevance: number;
  /** 原始向量余弦相似度；未命中向量时为 null */
  vectorSimilarity: number | null;
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
}

export interface KnowledgeSearchResponse {
  query: string;
  source: KnowledgeSearchSource;
  path: string;
  page: number;
  pageSize: number;
  /** 兼容旧字段：站内检索模式 */
  mode: 'hybrid' | 'fulltext';
  /** 兼容旧字段：站内检索结果 */
  results: KnowledgeSearchResult[];
  project: KnowledgeProjectSearchPage;
}

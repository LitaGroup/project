/** 知识路径规范化：内部统一为以 / 开头、无结尾 / 的绝对路径 */
export interface NormalizedKnowledgePath {
  /** 规范化后的绝对路径，如 /a/b/c；根目录为 / */
  path: string;
  /** 路径分段；根目录为空数组 */
  segments: string[];
  /** 父目录路径；根目录的父目录仍为 / */
  parentPath: string;
  /** 当前节点名；根目录为空串 */
  name: string;
}

function invalid(path: string, reason: string): never {
  throw new Error(`非法知识路径「${path}」：${reason}`);
}

function validateSegment(segment: string, original: string): string {
  if (!segment) invalid(original, '不能包含空路径段');
  if (segment === '.' || segment === '..') {
    invalid(original, '不能包含 . 或 ..');
  }
  if (segment.trim() !== segment) {
    invalid(original, '路径段首尾不能有空白');
  }
  if (
    Array.from(segment).some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || code === 127 || ch === '\\';
    })
  ) {
    invalid(original, '不能包含控制字符或反斜杠');
  }
  if (segment.length > 200) invalid(original, '单个路径段不能超过 200 个字符');
  return segment;
}

/**
 * 规范化知识路径。输入可带或不带首尾 /，但只能有一个语义：
 * `/a/b`、`a/b` 均得到 `/a/b`；根路径 `/` 单独保留。
 */
export function normalizeKnowledgePath(input: string): NormalizedKnowledgePath {
  const original = input;
  if (typeof input !== 'string') invalid(String(input), '路径必须是字符串');
  const trimmed = input.trim();
  if (!trimmed) return { path: '/', segments: [], parentPath: '/', name: '' };
  if (trimmed.includes('%2f') || trimmed.includes('%2F')) {
    invalid(original, '编码后的斜杠不能作为路径段内容');
  }
  if (trimmed.includes('//')) invalid(original, '不能包含连续斜杠');
  if (trimmed.includes('\\')) invalid(original, '不能包含反斜杠');

  const withoutEdges = trimmed.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!withoutEdges)
    return { path: '/', segments: [], parentPath: '/', name: '' };
  const segments = withoutEdges
    .split('/')
    .map((s) => validateSegment(s, original));
  if (segments.length > 50) invalid(original, '目录层级不能超过 50 层');
  const path = `/${segments.join('/')}`;
  if (path.length > 2000) invalid(original, '路径总长度不能超过 2000 个字符');
  const parentSegments = segments.slice(0, -1);
  return {
    path,
    segments,
    parentPath: parentSegments.length ? `/${parentSegments.join('/')}` : '/',
    name: segments[segments.length - 1],
  };
}

/** 仅用于拼接父子路径；name 不允许包含 / */
export function joinKnowledgePath(parent: string, name: string): string {
  const p = normalizeKnowledgePath(parent).path;
  const child = validateSegment(name.trim(), name);
  return p === '/' ? `/${child}` : `${p}/${child}`;
}

/** 判断 path 是否为 parent 自身或其后代 */
export function isKnowledgePathWithin(path: string, parent: string): boolean {
  const p = normalizeKnowledgePath(path).path;
  const base = normalizeKnowledgePath(parent).path;
  return base === '/' || p === base || p.startsWith(`${base}/`);
}

/** 项目文档在知识库中的固定保留路径 */
export function projectDocumentPath(
  projectId: number,
  documentId: number,
): string {
  return `/project/${projectId}/document/${documentId}`;
}

/** 项目在知识库中的保留路径（系统维护，不允许普通知识编辑） */
export function projectRootPath(projectId: number): string {
  return `/project/${projectId}`;
}

/** URL 路径编码：逐段编码，保留 / */
export function encodeKnowledgePath(path: string): string {
  const normalized = normalizeKnowledgePath(path);
  if (normalized.path === '/') return '/';
  return normalized.segments.map((s) => encodeURIComponent(s)).join('/');
}

import { pinyin } from 'pinyin-pro';

interface PinyinKeys {
  full: string;
  initials: string;
}

/** 拼音转换按原始字段缓存，避免每次搜索都重新转换长文本 */
const pinyinCache = new Map<string, PinyinKeys>();
const PINYIN_CACHE_LIMIT = 2000;

/** 只保留文字与数字，让空格、标点不影响拼音与组合查询 */
function compact(value: string): string {
  return value.replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 用户通常输入 nv 代替 nü，统一成 v 便于匹配 */
function normalizePinyin(value: string): string {
  return value.toLowerCase().replace(/ü/g, 'v').replace(/u:/g, 'v');
}

function pinyinKeys(text: string): PinyinKeys {
  const cached = pinyinCache.get(text);
  if (cached) return cached;

  const options = {
    toneType: 'none',
    type: 'array',
    nonZh: 'consecutive',
  } as const;
  const keys: PinyinKeys = {
    full: normalizePinyin(compact(pinyin(text, options).join(''))),
    initials: normalizePinyin(
      compact(pinyin(text, { ...options, pattern: 'first' }).join('')),
    ),
  };

  if (pinyinCache.size >= PINYIN_CACHE_LIMIT) pinyinCache.clear();
  pinyinCache.set(text, keys);
  return keys;
}

/**
 * 搜索关键词是否命中字段：中文/英文原文、全拼、拼音首字母。
 * 原文匹配保持现有忽略大小写子串行为；拼音匹配忽略空格与标点。
 */
export function matchesPinyinSearch(
  query: string,
  fields: ReadonlyArray<string | number | null | undefined>,
): boolean {
  const rawQuery = query.trim().toLowerCase();
  if (!rawQuery) return true;
  const compactQuery = compact(rawQuery);

  return fields.some((field) => {
    if (field == null) return false;
    const text = String(field).toLowerCase();
    if (text.includes(rawQuery)) return true;
    if (!compactQuery) return false;

    if (compact(text).includes(compactQuery)) return true;
    const keys = pinyinKeys(text);
    return (
      keys.full.includes(compactQuery) || keys.initials.includes(compactQuery)
    );
  });
}

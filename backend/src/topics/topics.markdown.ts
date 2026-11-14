import { mdFrontmatter } from '../common/frontmatter';
import type { TopicDetailView, TopicListResult } from './topics.types';

function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function typeLabel(type: string): string {
  if (type === 'question') return '问答';
  if (type === 'system') return '系统';
  return '内容';
}

function statusLabel(status: string): string {
  if (status === 'resolved') return '已解决';
  if (status === 'closed') return '已关闭';
  return '进行中';
}

/** 话题清单 Markdown（Agent 阅读/操作入口） */
export function renderTopicList(result: TopicListResult): string {
  const lines = [
    mdFrontmatter({
      title: `话题：${result.subjectTitle}`,
      subject: `${result.subjectType}:${result.subjectId}`,
      update: new Date(),
    }),
    `# 话题：${result.subjectTitle}`,
    '',
    `- 主体：${result.subjectType} / ${result.subjectId}`,
    `- 主话题 ID：${result.defaultTopicId ?? '—'}`,
    `- 话题总数：${result.total}`,
    `- 未读：${result.unreadTotal}`,
    '',
    '| ID | 标题 | 类型 | 状态 | 标签 | 回复 | 最后回复 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...result.items.map((item) =>
      [
        item.id,
        escapeCell(item.title || '（主话题）'),
        typeLabel(item.type),
        statusLabel(item.status),
        escapeCell(item.tags.join('、') || '—'),
        item.replyCount,
        item.lastReplyByName ?? '—',
      ].join(' | '),
    ),
    '',
    '## 操作',
    '',
    `- 读取详情：GET /api/topics/{id}.md`,
    `- 新开话题：POST /api/topics/create.md（subjectType=${result.subjectType}、subjectId=${result.subjectId}）`,
    '- 回复话题：POST /api/topics/{id}/reply.md',
    '- 答复问答：POST /api/topics/{id}/answer.md',
    '- 标记已解决：POST /api/topics/{id}/resolve.md',
    '',
  ];
  return lines.join('\n');
}

/** 话题详情 Markdown：正文 + 最近回复 */
export function renderTopicDetail(detail: TopicDetailView): string {
  const lines = [
    mdFrontmatter({
      title: detail.title || '主话题',
      subject: `${detail.subjectType}:${detail.subjectId}`,
      update: new Date(),
    }),
    `# ${detail.title || '主话题'}`,
    '',
    `- 主体：${detail.subjectTitle}（${detail.subjectType}:${detail.subjectId}）`,
    `- 类型：${typeLabel(detail.type)}`,
    `- 状态：${statusLabel(detail.status)}`,
    `- 标签：${detail.tags.join('、') || '—'}`,
    `- 作者：${detail.author.name}`,
    `- 回复：${detail.replyCount}`,
    `- 平台地址：${detail.subjectUrl}?topic=${detail.id}`,
    '',
    '## 正文',
    '',
    detail.content || '（主话题无正文，消息见下方回复）',
    '',
  ];
  if (detail.replies.length) {
    lines.push('## 最近回复', '');
    for (const reply of detail.replies.slice(-50)) {
      lines.push(
        `### ${reply.author.name} · ${new Date(reply.createdAt).toLocaleString('zh-CN')}`,
        '',
        reply.content || '（空）',
        '',
      );
    }
  }
  lines.push(
    '## 操作',
    '',
    `- 回复：POST /api/topics/${detail.id}/reply.md`,
    `- 新开话题：POST /api/topics/create.md`,
    '',
  );
  return lines.join('\n');
}

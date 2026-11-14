import type { User } from '../auth/user.entity';
import type { Worker } from '../workers/worker.entity';
import type {
  TopicAuthorType,
  TopicReplyStatus,
  TopicStatus,
  TopicSubjectType,
  TopicType,
} from '../common/enums';
import type { TopicMention, TopicQuestionPayload } from './topic.entity';

/** 话题操作人：网页用户 / 机器人令牌（真人机器人可能同时带 user） */
export interface TopicActor {
  user?: User;
  worker?: Worker;
  name: string;
  isAdmin: boolean;
  userId: number | null;
  workerId: number | null;
}

export interface TopicAuthorView {
  type: TopicAuthorType;
  id: number | null;
  name: string;
  avatarUrl: string | null;
}

export interface TopicReplyView {
  id: number;
  topicId: number;
  content: string;
  author: TopicAuthorView;
  images: string[] | null;
  mentions: TopicMention[] | null;
  metadata: Record<string, unknown> | null;
  status: TopicReplyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TopicView {
  id: number;
  subjectType: TopicSubjectType;
  subjectId: string;
  subjectTitle: string;
  subjectUrl: string;
  title: string | null;
  content: string;
  type: TopicType;
  status: TopicStatus;
  tags: string[];
  blocking: boolean;
  isDefault: boolean;
  pinned: boolean;
  locked: boolean;
  author: TopicAuthorView;
  images: string[] | null;
  mentions: TopicMention[] | null;
  metadata: TopicQuestionPayload | Record<string, unknown> | null;
  replyCount: number;
  unreadCount: number;
  lastReplyAt: string | null;
  lastReplyByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TopicDetailView extends TopicView {
  replies: TopicReplyView[];
  totalReplies: number;
}

export interface TopicListQuery {
  subjectType: TopicSubjectType;
  subjectId: string;
  q?: string;
  type?: TopicType;
  status?: TopicStatus;
  tag?: string;
  page?: number;
  pageSize?: number;
}

export interface TopicListResult {
  subjectType: TopicSubjectType;
  subjectId: string;
  subjectTitle: string;
  subjectUrl: string;
  defaultTopicId: number | null;
  total: number;
  page: number;
  pageSize: number;
  items: TopicView[];
  unreadTotal: number;
}

export interface CreateTopicInput {
  subjectType: TopicSubjectType;
  subjectId: string;
  title?: string;
  content: string;
  type?: TopicType;
  tags?: string[];
  mentions?: number[];
  images?: string[];
}

export interface UpdateTopicInput {
  title?: string | null;
  tags?: string[];
  status?: TopicStatus;
  pinned?: boolean;
  locked?: boolean;
}

export interface ReplyTopicInput {
  content: string;
  mentions?: number[];
  images?: string[];
}

export interface AnswerTopicInput {
  answers?: string[][];
  reject?: boolean;
}

export interface TopicSubjectInfo {
  type: TopicSubjectType;
  id: string;
  title: string;
  code: string | null;
  url: string;
  /** 主体绑定的飞书群（有群时每条回复发群通知） */
  group:
    | { kind: 'backlog'; id: number }
    | { kind: 'task'; id: number }
    | { kind: 'project'; id: number }
    | null;
  /** 任务/工单等主体当前执行机器人 */
  defaultWorkerId: number | null;
  /** 任务需求方用户（用于问答待回答通知） */
  requesterUserId: number | null;
}

export interface TopicNotificationView {
  id: number;
  type: string;
  topicId: number;
  replyId: number | null;
  title: string;
  content: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface TopicNotificationList {
  total: number;
  unread: number;
  items: TopicNotificationView[];
}

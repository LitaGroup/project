import {
  BacklogMemberRole,
  BacklogStatus,
  IterationStatus,
  IterationType,
} from '../common/enums';

/** 操作用户身份（网页为真人登录；只有管理员可创建/追加/移动迭代项） */
export interface IterationActor {
  userId: number | null;
  userName: string;
  isAdmin: boolean;
}

export interface CreateIterationInput {
  /** 唯一标识（W1，如 W2026-46） */
  code: string;
  name: string;
  /** 开始日期 YYYY-MM-DD（W1 必填） */
  startAt?: string | null;
  /** 结束日期 YYYY-MM-DD（W1 必填） */
  endAt?: string | null;
}

export interface UpdateIterationInput {
  name?: string;
  startAt?: string | null;
  endAt?: string | null;
  status?: IterationStatus;
}

/** 迭代项成员入参：角色 + 平台用户 */
export interface BacklogMemberInput {
  role: BacklogMemberRole;
  userId: number;
}

/** 转入/追加迭代项：原始需求 + 负责人机器人 + 成员 */
export interface CreateBacklogItemInput {
  projectId: number;
  ownerWorkerId: number;
  members?: BacklogMemberInput[];
}

/** 迭代进度汇总 */
export interface IterationProgress {
  total: number;
  done: number;
  percent: number;
  statusCounts: Partial<Record<BacklogStatus, number>>;
}

/** 迭代列表项（含 backlog 进度） */
export interface IterationSummaryView extends IterationProgress {
  id: number;
  code: string;
  type: IterationType;
  name: string;
  startAt: string | null;
  endAt: string | null;
  status: IterationStatus;
  /** 是否当前迭代（W1 今天在起止区间内；T0 恒为 true） */
  current: boolean;
  createdAt: Date;
  updatedAt: Date;
}

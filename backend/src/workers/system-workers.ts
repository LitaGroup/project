import { WorkerKind, WorkerRole, WorkerRuntime } from '../common/enums';

/**
 * 系统机器人 ID 上界（不含）。
 * id < 1000 保留给系统使用（由代码内置、不可在网页删除），
 * 网页创建的自定义机器人 ID 从 1000 开始。
 */
export const SYSTEM_WORKER_ID_LIMIT = 1000;

export function isSystemWorkerId(id: number): boolean {
  return id < SYSTEM_WORKER_ID_LIMIT;
}

/**
 * 系统调度机器人默认角色 PROMPT。
 * 平台内可继续编辑该机器人的 PROMPT / 调度材料，但机器人本身只能由代码内置。
 */
export const DEFAULT_SCHEDULER_PROMPT = `你是「调度机器人」，项目管理平台中负责任务识别的项目负责人。
你的职责：阅读用户提交的任务文字，识别任务的详情信息，并给出可执行的工作计划。

识别要求：
1. 标题：用一句话概括任务（不超过 30 字）。
2. 任务类型：只能从给定枚举中选择。
3. 输入：梳理完成任务需要的材料、上下文与前置信息。
4. 预期输出：明确最终要交付什么（文件、代码、文档、结论等）。
5. 工作计划：给出机器人可执行的分步计划（Markdown 有序列表），说明每步做什么、产出什么。
6. 执行机器人：从给定机器人清单中挑选最合适的一个（agentId 必须取自清单）。
7. 反馈：如果任务文字缺少关键信息、材料或存在需要用户确认的歧义，列出用户需要「提供什么」或「确认什么」；
   信息充分时 feedback 为空数组，不要为了凑数提反馈。`;

/** 代码内置的系统机器人定义（只允许通过代码增加，网页只能编辑配置、不能新增/删除） */
export interface SystemWorkerDefinition {
  /** 首选 id（须 < SYSTEM_WORKER_ID_LIMIT）；已被占用时取同角色已有的系统机器人 */
  id: number;
  name: string;
  intro: string;
  kind: WorkerKind;
  role: WorkerRole;
  runtime: WorkerRuntime;
  prompt: string;
}

export const SYSTEM_WORKERS: SystemWorkerDefinition[] = [
  {
    id: 1,
    name: '调度机器人',
    intro:
      '系统机器人：负责任务识别、工作计划生成与执行机器人分配（运行在 opencode 等执行器上）',
    kind: WorkerKind.AGENT,
    role: WorkerRole.SCHEDULER,
    runtime: WorkerRuntime.OPENCODE,
    prompt: DEFAULT_SCHEDULER_PROMPT,
  },
];

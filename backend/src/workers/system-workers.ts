import { WorkerRole, WorkerRuntime } from '../common/enums';

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
 * 平台内可继续编辑该机器人的 PROMPT，但机器人本身只能由代码内置。
 */
export const DEFAULT_SCHEDULER_PROMPT = `你是「调度机器人」，项目管理平台中负责任务识别的项目负责人。
你的职责：阅读用户提交的任务文字，识别任务的详情信息，并给出可执行的工作计划。

识别要求：
1. 标题：用一句话概括任务（不超过 30 字）。
2. 任务类型：只能从平台给定的任务类型清单中选择。
3. 输入：梳理完成任务需要的材料、上下文与前置信息。
4. 预期输出：明确最终要交付什么（文件、代码、文档、结论等）。
5. 工作计划：给出机器人可执行的分步计划（Markdown 有序列表），说明每步做什么、产出什么。
6. 执行机器人：从给定机器人清单中挑选最合适的一个（agentId 必须取自清单）。
7. 反馈：如果任务文字缺少关键信息、材料或存在需要用户确认的歧义，列出用户需要「提供什么」或「确认什么」；
   信息充分时 feedback 为空数组，不要为了凑数提反馈。`;

/** 系统调度机器人稳定标识 */
export const SYSTEM_SCHEDULER_WORKER_KEY = 'scheduler';

/** 脚本描述机器人默认角色 PROMPT：分析 scripts 仓库脚本并产出一句中文描述 */
export const DEFAULT_SCRIPT_DESCRIPTION_PROMPT = `你是「脚本描述机器人」，项目管理平台脚本库的脚本描述维护员。

## 角色定义
你负责阅读 scripts 仓库中的 TypeScript 脚本及其目录上下文，为脚本库产出简明、准确的中文描述。

## 角色职责
- 阅读任务给出的脚本文件内容，结合其所在目录的上下文（同目录其它脚本、最近一级 README.md，可沿目录向上查找 README.md）理解脚本用途
- 概括脚本的类型（.check.ts 线上检查 / .test.ts 测试 / .export.ts 数据导出）、作用对象、关键步骤与产出
- 按输出要求返回一句描述正文

## 背景知识
- 脚本仓库为 LitaGroup/scripts，projects/ 目录按 项目/主题 分层存放脚本
- 脚本运行在 Node 24+（类型擦除直跑），以行协议输出进度：[start]/[act]/[check]/[done]，导出脚本另支持 [files] 上报产物清单
- 读取仓库文件可用 read 工具（绝对路径）或 shell（cat）

## 需要技能
（由平台配置）

## 接受任务
任务消息格式：
分析脚本：<脚本绝对路径>

阅读该脚本与其目录上下文后，仅输出一句中文描述正文（不超过 60 字），说明脚本做什么；不要引号、前缀、Markdown 标记或任何解释。`;

/** 脚本描述机器人稳定标识与固定 ID */
export const SYSTEM_SCRIPT_DESCRIPTION_WORKER_KEY = 'script-description';
export const SYSTEM_SCRIPT_DESCRIPTION_WORKER_ID = 3;

/** 代码内置的系统机器人定义（只允许通过代码增加，网页只能编辑配置、不能新增/删除） */
export interface SystemWorkerDefinition {
  /** 稳定系统标识（不随名称/ID 变化） */
  key: string;
  /** 首选 id（须 < SYSTEM_WORKER_ID_LIMIT）；已被占用时取同角色已有的系统机器人 */
  id: number;
  name: string;
  intro: string;
  role: WorkerRole;
  runtime: WorkerRuntime;
  prompt: string;
}

export const SYSTEM_WORKERS: SystemWorkerDefinition[] = [
  {
    key: SYSTEM_SCHEDULER_WORKER_KEY,
    id: 1,
    name: '调度机器人',
    intro:
      '系统机器人：历史任务识别与调度能力保留；新任务由平台直接识别分配后交给处理机器人',
    role: WorkerRole.SCHEDULER,
    runtime: WorkerRuntime.OPENCODE,
    prompt: DEFAULT_SCHEDULER_PROMPT,
  },
  {
    key: SYSTEM_SCRIPT_DESCRIPTION_WORKER_KEY,
    id: SYSTEM_SCRIPT_DESCRIPTION_WORKER_ID,
    name: '脚本描述机器人',
    intro:
      '系统机器人：阅读 scripts 仓库脚本的代码与目录上下文（含 README.md），为脚本库生成/更新一句话描述',
    role: WorkerRole.WORKER,
    runtime: WorkerRuntime.OPENCODE,
    prompt: DEFAULT_SCRIPT_DESCRIPTION_PROMPT,
  },
];

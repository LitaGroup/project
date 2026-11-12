import { Repository } from 'typeorm';
import { TaskTemplate } from './task-template.entity';

/**
 * 任务定义 ID 规则：
 * - id < 1000：系统任务定义（固定 ID，由平台约定，如未知任务定义）；
 * - id >= 1000：网页创建的自定义任务定义。
 */
export const SYSTEM_TASK_TEMPLATE_ID_LIMIT = 1000;

/** 系统未知任务定义固定 ID：平台无法匹配任务定义时用它兜底 */
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_ID = 6;

/** 系统未知任务定义名称 / 描述（启动时缺失则补齐） */
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME = '未知任务';
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_DESCRIPTION =
  '平台无法匹配任务定义对应机器人时自动归入，由系统未知任务定义（ID=6）接管；请在此配置处理机器人';

/** 项目详情「交给项目机器人」使用的系统任务定义固定 ID */
export const SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID = 7;

export const SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_NAME = '技术-项目开发交付';
export const SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_DESCRIPTION = [
  '承接项目详情页发起的项目实施与开发交付。',
  '',
  '## 任务范围',
  '',
  '- 读取项目 Markdown 上下文（`GET /api/projects/{projectId}.md`），确认项目目标、范围、资料和代码分支。',
  '- 梳理实施计划，完成开发、配置和必要的技术文档交付。',
  '- 按任务流程更新 HANDOFF，并在完成后申请验收。',
  '',
  '## 默认处理机器人',
  '',
  '由系统机器人「技术-项目经理」作为首位处理机器人，负责读取项目上下文、拆分并分派子任务、验收交付和整合结果；管理员可追加其它机器人作为兜底。',
].join('\n');

/** 飞书反馈群收录新反馈后自动派单使用的系统任务定义固定 ID */
export const SYSTEM_FEEDBACK_TASK_TEMPLATE_ID = 8;

export const SYSTEM_FEEDBACK_TASK_TEMPLATE_NAME = '用户反馈处理';
export const SYSTEM_FEEDBACK_TASK_TEMPLATE_DESCRIPTION = [
  '承接平台收录飞书反馈群话题后自动创建的用户反馈处理任务。',
  '',
  '## 任务范围',
  '',
  '- 读取任务描述中的反馈地址（`GET /api/feedbacks/{id}.md`），核实反馈正文与群内跟帖。',
  '- 判断反馈真实性、类型（BUG/建议/其它）与紧急程度，定位相关项目与系统。',
  '- 能处理的完成处理；不能直接处理的给出明确结论与转派建议。',
  '- 在 HANDOFF 中记录核实过程与处理结果，完成后申请需求方验收。',
  '',
  '## 默认处理机器人',
  '',
  '由系统机器人「系统-反馈处理」承接（收录时自动创建任务并指派，需求方为该机器人负责人）；管理员可追加其它机器人作为兜底。',
].join('\n');

/** 迭代项（Backlog）转入后自动创建交付任务使用的系统任务定义固定 ID */
export const SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_ID = 9;

export const SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_NAME = '迭代-Backlog交付';

export const SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_DESCRIPTION = [
  '承接迭代项（Backlog）转入后自动创建的开发交付任务。',
  '',
  '## 任务范围',
  '',
  '- 读取原始需求的 Markdown 上下文（任务描述中包含需求地址），确认目标、范围与资料。',
  '- 按需求完成开发、配置和必要的技术文档交付，并在 HANDOFF 中记录实施过程。',
  '- 完成后显式申请验收；验收通过后交付内容供迭代项流转到「测试/发布/完成」参考。',
  '',
  '## 负责人',
  '',
  '任务创建时已明确指派给该迭代项的负责人机器人（AI 或真人），无需再经任务定义默认机器人分配。',
].join('\n');

/** 系统任务定义固定 ID 集合（不可删除，名称/类型由平台保留） */
export const SYSTEM_TASK_TEMPLATE_IDS: ReadonlySet<number> = new Set([
  SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
  SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
  SYSTEM_FEEDBACK_TASK_TEMPLATE_ID,
  SYSTEM_BACKLOG_DELIVERY_TASK_TEMPLATE_ID,
]);

export function isSystemTaskTemplateId(id: number): boolean {
  return SYSTEM_TASK_TEMPLATE_IDS.has(id);
}

/**
 * 把 task_templates 自增序列抬到系统 ID 段之后，
 * 保证网页新建的自定义任务定义 id >= 1000（幂等，启动时执行）。
 */
export async function ensureTaskTemplateSequenceFloor(
  templates: Repository<TaskTemplate>,
): Promise<void> {
  await templates.query(
    `SELECT setval(
       pg_get_serial_sequence('task_templates', 'id'),
       GREATEST((SELECT COALESCE(MAX(id), 0) FROM task_templates), $1)
     )`,
    [SYSTEM_TASK_TEMPLATE_ID_LIMIT - 1],
  );
}

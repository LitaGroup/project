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

/** 系统任务定义固定 ID 集合（不可删除，名称/类型由平台保留） */
export const SYSTEM_TASK_TEMPLATE_IDS: ReadonlySet<number> = new Set([
  SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
  SYSTEM_PROJECT_DELIVERY_TASK_TEMPLATE_ID,
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

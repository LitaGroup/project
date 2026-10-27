import { Repository } from 'typeorm';
import { TaskTemplate } from './task-template.entity';

/**
 * 任务定义 ID 规则：
 * - id < 1000：系统任务定义（固定 ID，由平台约定，如未知任务定义）；
 * - id >= 1000：网页创建的自定义任务定义。
 */
export const SYSTEM_TASK_TEMPLATE_ID_LIMIT = 1000;

/** 系统未知任务定义固定 ID：平台无法匹配任务定义/类型时用它兜底 */
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_ID = 6;

/** 系统未知任务定义名称 / 描述（启动时缺失则补齐） */
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_NAME = '未知任务';
export const SYSTEM_UNKNOWN_TASK_TEMPLATE_DESCRIPTION =
  '平台无法匹配任务定义/类型对应机器人时自动归入，由系统未知任务定义（ID=6）接管；请在此配置处理机器人';

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

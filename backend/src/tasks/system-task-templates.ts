import { Repository } from 'typeorm';
import { TASK_TYPE_TICKET } from '../task-types/task-type.entity';
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

/** 工单任务使用的系统任务类型（不可改名/删除） */
export const TICKET_TASK_TYPE = TASK_TYPE_TICKET;

/** 工单类型默认调度任务定义固定 ID 段（10-15） */
export interface TicketDispatchTemplateDefinition {
  id: number;
  category: string;
  name: string;
  description: string;
}

const ticketDispatchPrompt = (
  category: string,
  instruction: string,
): string => `# 工单调度

你是「${category}」的调度机器人，负责澄清需求并把工单转交给后续任务定义。

1. 阅读任务与工单信息，判断需求是否足够明确。
2. 信息不足时调用 \`POST /api/tasks/{taskId}/questions/ask.md\` 向需求方提问；提交后停止本轮。
3. 信息明确后调用 \`GET /api/tasks/{taskId}/ticket.md\` 查看本工单允许转派的任务定义。
4. 调用 \`POST /api/tasks/{taskId}/ticket-route.md\` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。
5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。

${instruction}`;

export const SYSTEM_TICKET_TASK_TEMPLATES: TicketDispatchTemplateDefinition[] =
  [
    {
      id: 10,
      category: '方案工单',
      name: '工单-方案工单-调度',
      description: ticketDispatchPrompt(
        '方案工单',
        '适用于方案设计类工单：先澄清业务目标、范围、约束与验收标准，再转交方案设计相关任务定义。',
      ),
    },
    {
      id: 11,
      category: '技术工单',
      name: '工单-技术工单-调度',
      description: ticketDispatchPrompt(
        '技术工单',
        '适用于业务同学向技术同学申请完成技术任务：先澄清目标、现状与交付范围，再转交技术相关任务定义。',
      ),
    },
    {
      id: 12,
      category: '数据工单',
      name: '工单-数据工单-调度',
      description: ticketDispatchPrompt(
        '数据工单',
        '适用于数据查询、数据导出、报表设计等申请：先澄清口径、时间范围与输出格式，再转交数据相关任务定义。',
      ),
    },
    {
      id: 13,
      category: '运维工单',
      name: '工单-运维工单-调度',
      description: ticketDispatchPrompt(
        '运维工单',
        '适用于线上操作申请，包括数据库操作、NACOS 操作等：先确认环境、对象、变更内容与回滚方案，再转交运维相关任务定义。',
      ),
    },
    {
      id: 14,
      category: '需求工单',
      name: '工单-需求工单-调度',
      description: ticketDispatchPrompt(
        '需求工单',
        '适用于业务同学向产品同学提出需求申请：先澄清业务背景、用户价值与优先级，再转交需求相关任务定义。',
      ),
    },
    {
      id: 15,
      category: 'BUG反馈',
      name: '工单-BUG工单-调度',
      description: ticketDispatchPrompt(
        'BUG反馈',
        '适用于线上故障反馈：先收集出现时间、环境、用户影响、复现步骤与截图，再转交排查修复相关任务定义。',
      ),
    },
  ];

/** 系统任务定义固定 ID 集合（不可删除，名称/类型由平台保留） */
export const SYSTEM_TASK_TEMPLATE_IDS: ReadonlySet<number> = new Set([
  SYSTEM_UNKNOWN_TASK_TEMPLATE_ID,
  ...SYSTEM_TICKET_TASK_TEMPLATES.map((item) => item.id),
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

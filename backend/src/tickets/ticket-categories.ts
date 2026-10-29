import {
  SYSTEM_TICKET_TASK_TEMPLATES,
  TICKET_TASK_TYPE,
} from '../tasks/system-task-templates';

export { TICKET_TASK_TYPE };

/** 当前已开放创建的工单类型；其余类型只保留配置入口与内置任务定义 */
export const ENABLED_TICKET_CATEGORIES: ReadonlySet<string> = new Set([
  '方案工单',
]);

export interface TicketCategoryDefinition {
  category: string;
  defaultTemplateId: number;
  defaultTemplateName: string;
  enabled: boolean;
  description: string;
}

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  方案工单: '针对方案设计的工单，由调度机器人澄清后转交方案设计任务定义',
  技术工单: '业务同学向技术同学申请完成某个任务（暂未开放）',
  数据工单: '数据查询、数据导出、报表设计等申请（暂未开放）',
  运维工单: '线上数据库、NACOS 等操作申请（暂未开放）',
  需求工单: '业务同学向产品同学提出需求申请（暂未开放）',
  BUG反馈: '线上故障反馈工单（暂未开放）',
};

/** 六类工单与固定默认调度任务定义的唯一映射 */
export const TICKET_CATEGORIES: TicketCategoryDefinition[] =
  SYSTEM_TICKET_TASK_TEMPLATES.map((template) => ({
    category: template.category,
    defaultTemplateId: template.id,
    defaultTemplateName: template.name,
    enabled: ENABLED_TICKET_CATEGORIES.has(template.category),
    description: CATEGORY_DESCRIPTIONS[template.category] ?? '',
  }));

export function findTicketCategory(
  category: string | null | undefined,
): TicketCategoryDefinition | null {
  const value = (category ?? '').trim();
  if (!value) return null;
  return TICKET_CATEGORIES.find((item) => item.category === value) ?? null;
}

export function isEnabledTicketCategory(category: string): boolean {
  return ENABLED_TICKET_CATEGORIES.has(category);
}

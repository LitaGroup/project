import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 退役六类工单调度任务定义（ID 10-15）：
 * 工单已改为工作流模型（节点直接绑定任务定义），旧「工单-xxxx-调度」不再使用。
 *
 * - 阻止：工作流草稿/发布版本仍引用这些定义时迁移失败，需先在工单配置中改绑；
 * - 清理：task_template_follows 关注记录与 task_templates 定义；
 * - 保留：tasks / tickets / ticket_workflow_runs 的历史快照
 *   （templateId/templateName/taskTemplateId/taskTemplateName）不动，历史记录仍可查看。
 */
export class RemoveTicketDispatchTemplates1796200000000 implements MigrationInterface {
  name = 'RemoveTicketDispatchTemplates1796200000000';

  private static readonly IDS = [10, 11, 12, 13, 14, 15];

  /** 退役定义的历史名称（删除时按 ID+名称匹配，避免误删同名以外的数据） */
  private static readonly NAMES: Record<number, string> = {
    10: '工单-方案工单-调度',
    11: '工单-技术工单-调度',
    12: '工单-数据工单-调度',
    13: '工单-运维工单-调度',
    14: '工单-需求工单-调度',
    15: '工单-BUG工单-调度',
  };

  /** 退役定义的描述快照（down 回滚时按原文恢复） */
  private static readonly DESCRIPTIONS: Record<number, string> = {
    10: '# 工单调度\n\n你是「方案工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于方案设计类工单：先澄清业务目标、范围、约束与验收标准，再转交方案设计相关任务定义。',
    11: '# 工单调度\n\n你是「技术工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于业务同学向技术同学申请完成技术任务：先澄清目标、现状与交付范围，再转交技术相关任务定义。',
    12: '# 工单调度\n\n你是「数据工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于数据查询、数据导出、报表设计等申请：先澄清口径、时间范围与输出格式，再转交数据相关任务定义。',
    13: '# 工单调度\n\n你是「运维工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于线上操作申请，包括数据库操作、NACOS 操作等：先确认环境、对象、变更内容与回滚方案，再转交运维相关任务定义。',
    14: '# 工单调度\n\n你是「需求工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于业务同学向产品同学提出需求申请：先澄清业务背景、用户价值与优先级，再转交需求相关任务定义。',
    15: '# 工单调度\n\n你是「BUG反馈」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于线上故障反馈：先收集出现时间、环境、用户影响、复现步骤与截图，再转交排查修复相关任务定义。',
  };

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 工作流引用校验：草稿或发布版本仍引用退役定义时阻止迁移
    const checks: Array<{ table: string; column: string }> = [
      { table: 'workflow_definitions', column: 'draftDefinition' },
      { table: 'workflow_definition_versions', column: 'definition' },
    ];
    const idList = RemoveTicketDispatchTemplates1796200000000.IDS.join(', ');
    for (const { table, column } of checks) {
      if (!(await queryRunner.hasTable(table))) continue;
      const rows = (await queryRunner.query(
        `SELECT "id" FROM "${table}"
         WHERE jsonb_typeof("${column}" -> 'nodes') = 'array'
           AND EXISTS (
             SELECT 1 FROM jsonb_array_elements("${column}" -> 'nodes') node
             WHERE (node ->> 'taskTemplateId') IS NOT NULL
               AND (node ->> 'taskTemplateId')::int IN (${idList})
           )`,
      )) as Array<{ id: number }>;
      if (rows.length) {
        throw new Error(
          `${table} #${rows.map((row) => row.id).join(',')} 仍引用已退役的` +
            `工单调度任务定义（ID 10-15），请先在「管理 → 工单配置」把节点改绑到其它任务定义后再执行迁移`,
        );
      }
    }

    // 2. 清理关注记录与定义本身（历史任务/工单快照不受影响）
    if (await queryRunner.hasTable('task_template_follows')) {
      await queryRunner.query(
        `DELETE FROM "task_template_follows" WHERE "templateId" IN (${idList})`,
      );
    }
    for (const id of RemoveTicketDispatchTemplates1796200000000.IDS) {
      await queryRunner.query(
        `DELETE FROM "task_templates" WHERE "id" = $1 AND "name" = $2 AND "type" = '工单'`,
        [id, RemoveTicketDispatchTemplates1796200000000.NAMES[id]],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const id of RemoveTicketDispatchTemplates1796200000000.IDS) {
      await queryRunner.query(
        `INSERT INTO "task_templates" ("id", "name", "type", "description", "agentIds")
         VALUES ($1, $2, '工单', $3, '[]')
         ON CONFLICT ("id") DO NOTHING`,
        [
          id,
          RemoveTicketDispatchTemplates1796200000000.NAMES[id],
          RemoveTicketDispatchTemplates1796200000000.DESCRIPTIONS[id],
        ],
      );
    }
  }
}

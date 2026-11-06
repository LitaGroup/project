import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 工单：tickets + ticket_configs，并预置「工单」任务类型与六个系统调度任务定义（ID 10-15）。
 * 固定 ID 已被其他定义占用时迁移失败，避免覆盖存量业务数据。
 *
 * 注意：六个调度定义随后由迁移 `1796200000000-remove-ticket-dispatch-templates` 退役
 * （工单已改为工作流模型）；此处保留历史预置逻辑，定义文本为当时的快照、不再引用业务常量。
 */
export class AddTickets1794300000000 implements MigrationInterface {
  name = 'AddTickets1794300000000';

  /** 历史调度任务定义（已退役，仅本迁移使用） */
  private static readonly DISPATCH_TEMPLATES = [
    {
      id: 10,
      name: '工单-方案工单-调度',
      description:
        '# 工单调度\n\n你是「方案工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于方案设计类工单：先澄清业务目标、范围、约束与验收标准，再转交方案设计相关任务定义。',
    },
    {
      id: 11,
      name: '工单-技术工单-调度',
      description:
        '# 工单调度\n\n你是「技术工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于业务同学向技术同学申请完成技术任务：先澄清目标、现状与交付范围，再转交技术相关任务定义。',
    },
    {
      id: 12,
      name: '工单-数据工单-调度',
      description:
        '# 工单调度\n\n你是「数据工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于数据查询、数据导出、报表设计等申请：先澄清口径、时间范围与输出格式，再转交数据相关任务定义。',
    },
    {
      id: 13,
      name: '工单-运维工单-调度',
      description:
        '# 工单调度\n\n你是「运维工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于线上操作申请，包括数据库操作、NACOS 操作等：先确认环境、对象、变更内容与回滚方案，再转交运维相关任务定义。',
    },
    {
      id: 14,
      name: '工单-需求工单-调度',
      description:
        '# 工单调度\n\n你是「需求工单」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于业务同学向产品同学提出需求申请：先澄清业务背景、用户价值与优先级，再转交需求相关任务定义。',
    },
    {
      id: 15,
      name: '工单-BUG工单-调度',
      description:
        '# 工单调度\n\n你是「BUG反馈」的调度机器人，负责澄清需求并把工单转交给后续任务定义。\n\n1. 阅读任务与工单信息，判断需求是否足够明确。\n2. 信息不足时调用 `POST /api/tasks/{taskId}/questions/ask.md` 向需求方提问（questions 内 options 为 {label, description?} 对象数组，不要传字符串）；提交后停止本轮。\n3. 信息明确后调用 `GET /api/tasks/{taskId}/ticket.md` 查看本工单允许转派的任务定义。\n4. 调用 `POST /api/tasks/{taskId}/ticket-route.md` 更新任务定义并转交新机器人，body 需包含 templateId、title、content、outputSpec、workPlan。\n5. 不得自行申请验收或创建子任务；工单由转交后的处理机器人完成并提交验收。\n\n适用于线上故障反馈：先收集出现时间、环境、用户影响、复现步骤与截图，再转交排查修复相关任务定义。',
    },
  ];

  /** 历史工单配置（类别 → 默认调度定义；enabled 为当时的开放状态） */
  private static readonly CATEGORY_CONFIGS = [
    { category: '方案工单', defaultTemplateId: 10, enabled: false },
    { category: '技术工单', defaultTemplateId: 11, enabled: true },
    { category: '数据工单', defaultTemplateId: 12, enabled: true },
    { category: '运维工单', defaultTemplateId: 13, enabled: false },
    { category: '需求工单', defaultTemplateId: 14, enabled: false },
    { category: 'BUG反馈', defaultTemplateId: 15, enabled: false },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('task_types'))) {
      throw new Error('tickets 迁移依赖 task_types 表，请先执行历史迁移');
    }
    await queryRunner.query(
      `INSERT INTO task_types (name, description)
       VALUES ('工单', '工单创建的调度任务类型，按工单类型绑定的系统任务定义分发，不允许改名与删除')
       ON CONFLICT (name) DO NOTHING`,
    );

    if (!(await queryRunner.hasTable('task_templates'))) {
      throw new Error('tickets 迁移依赖 task_templates 表，请先执行历史迁移');
    }
    for (const definition of AddTickets1794300000000.DISPATCH_TEMPLATES) {
      const rows = (await queryRunner.query(
        `SELECT id, name, type FROM task_templates WHERE id = $1`,
        [definition.id],
      )) as Array<{ id: number; name: string; type: string }>;
      const existing = rows[0];
      if (existing) {
        if (existing.name !== definition.name || existing.type !== '工单') {
          throw new Error(
            `系统工单任务定义 ID=${definition.id} 已被「${existing.name}」占用，` +
              `期望「${definition.name}」且类型为「工单」，请先清理冲突数据`,
          );
        }
        continue;
      }
      await queryRunner.query(
        `INSERT INTO task_templates (id, name, type, description, "agentIds")
         VALUES ($1, $2, '工单', $3, '[]')`,
        [definition.id, definition.name, definition.description],
      );
    }

    if (!(await queryRunner.hasTable('tickets'))) {
      await queryRunner.query(`
        CREATE TABLE "tickets" (
          "id" SERIAL PRIMARY KEY,
          "code" varchar(30) NOT NULL UNIQUE,
          "category" varchar(64) NOT NULL,
          "title" varchar(200) NOT NULL,
          "description" text,
          "createdById" integer NOT NULL,
          "createdByName" varchar(100) NOT NULL,
          "assigneeType" varchar(20) NOT NULL,
          "assigneeId" integer NOT NULL,
          "assigneeName" varchar(100) NOT NULL,
          "taskId" integer NOT NULL,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now()
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_tickets_category" ON "tickets" ("category")`,
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX "IDX_tickets_taskId" ON "tickets" ("taskId")`,
      );
    }

    if (!(await queryRunner.hasTable('ticket_configs'))) {
      await queryRunner.query(`
        CREATE TABLE "ticket_configs" (
          "category" varchar(64) PRIMARY KEY,
          "defaultTemplateId" integer NOT NULL,
          "allowedTemplateIds" text NOT NULL DEFAULT '[]',
          "enabled" boolean NOT NULL DEFAULT false,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now()
        )
      `);
    }

    for (const item of AddTickets1794300000000.CATEGORY_CONFIGS) {
      await queryRunner.query(
        `INSERT INTO ticket_configs ("category", "defaultTemplateId", "allowedTemplateIds", "enabled")
         VALUES ($1, $2, '[]', $3)
         ON CONFLICT ("category") DO NOTHING`,
        [item.category, item.defaultTemplateId, item.enabled],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_configs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tickets"`);
    for (const definition of AddTickets1794300000000.DISPATCH_TEMPLATES) {
      await queryRunner.query(
        `DELETE FROM task_templates
         WHERE id = $1 AND name = $2 AND type = '工单'`,
        [definition.id, definition.name],
      );
    }
    await queryRunner.query(
      `DELETE FROM task_types WHERE name = '工单'
       AND NOT EXISTS (SELECT 1 FROM tasks WHERE type = '工单')
       AND NOT EXISTS (SELECT 1 FROM task_templates WHERE type = '工单')`,
    );
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { TICKET_CATEGORIES } from '../tickets/ticket-categories';
import { SYSTEM_TICKET_TASK_TEMPLATES } from '../tasks/system-task-templates';

/**
 * 工单：tickets + ticket_configs，并预置「工单」任务类型与六个系统调度任务定义（ID 10-15）。
 * 固定 ID 已被其他定义占用时迁移失败，避免覆盖存量业务数据。
 */
export class AddTickets1794300000000 implements MigrationInterface {
  name = 'AddTickets1794300000000';

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
    for (const definition of SYSTEM_TICKET_TASK_TEMPLATES) {
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

    for (const item of TICKET_CATEGORIES) {
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
    for (const definition of SYSTEM_TICKET_TASK_TEMPLATES) {
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

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 工单工作流新模型：
 * - 工单配置允许多个（去掉 category 唯一约束）；
 * - tickets 支持「配置 + 发布版本 + 发起机器人 + 结构化输入」的工作流实例；
 * - ticket_workflow_runs 记录每个节点的多次运行。
 */
export class AddTicketWorkflowRuntime1796000000000 implements MigrationInterface {
  name = 'AddTicketWorkflowRuntime1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_workflow_definitions_category"`,
    );

    await queryRunner.query(`
      ALTER TABLE "tickets"
        ALTER COLUMN "taskId" DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS "workflowDefinitionId" integer,
        ADD COLUMN IF NOT EXISTS "workflowVersionId" integer,
        ADD COLUMN IF NOT EXISTS "workflowVersion" integer,
        ADD COLUMN IF NOT EXISTS "initiatorWorkerId" integer,
        ADD COLUMN IF NOT EXISTS "initiatorWorkerName" varchar(100),
        ADD COLUMN IF NOT EXISTS "inputValues" text,
        ADD COLUMN IF NOT EXISTS "workflowStatus" varchar(20),
        ADD COLUMN IF NOT EXISTS "currentNodeKey" varchar(64),
        ADD COLUMN IF NOT EXISTS "currentNodeName" varchar(100)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tickets_workflowDefinitionId"
      ON "tickets" ("workflowDefinitionId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket_workflow_runs" (
        "id" SERIAL PRIMARY KEY,
        "ticketId" integer NOT NULL,
        "nodeKey" varchar(64) NOT NULL,
        "nodeName" varchar(100) NOT NULL,
        "nodeKind" varchar(20) NOT NULL,
        "attempt" integer NOT NULL DEFAULT 1,
        "taskTemplateId" integer,
        "taskTemplateName" varchar(100),
        "agentId" integer,
        "agentName" varchar(100),
        "taskId" integer,
        "status" varchar(20) NOT NULL,
        "outcome" varchar(20),
        "startedAt" timestamptz,
        "finishedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_ticket_workflow_runs_ticket_node_attempt"
      ON "ticket_workflow_runs" ("ticketId", "nodeKey", "attempt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ticket_workflow_runs_ticketId"
      ON "ticket_workflow_runs" ("ticketId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ticket_workflow_runs_taskId"
      ON "ticket_workflow_runs" ("taskId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_workflow_runs"`);
    await queryRunner.query(`
      ALTER TABLE "tickets"
        DROP COLUMN IF EXISTS "currentNodeName",
        DROP COLUMN IF EXISTS "currentNodeKey",
        DROP COLUMN IF EXISTS "workflowStatus",
        DROP COLUMN IF EXISTS "inputValues",
        DROP COLUMN IF EXISTS "initiatorWorkerName",
        DROP COLUMN IF EXISTS "initiatorWorkerId",
        DROP COLUMN IF EXISTS "workflowVersion",
        DROP COLUMN IF EXISTS "workflowVersionId",
        DROP COLUMN IF EXISTS "workflowDefinitionId"
    `);
    // 历史工作流工单没有 taskId；该列恢复 NOT NULL 仅适用于未使用新模型的数据
    await queryRunner.query(
      `UPDATE "tickets" SET "taskId" = 0 WHERE "taskId" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "tickets" ALTER COLUMN "taskId" SET NOT NULL`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workflow_definitions_category"
      ON "workflow_definitions" ("category")
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tickets_workflowDefinitionId"`,
    );
  }
}

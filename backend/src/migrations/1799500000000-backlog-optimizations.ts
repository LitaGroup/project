import { MigrationInterface, QueryRunner } from 'typeorm';
import { RELEASE_TICKET_WORKFLOW } from '../workflows/system-workflows';

/**
 * 迭代项（Backlog）优化：
 * - backlogs.expected_online_at：预期上线时间（到小时）；
 * - backlog_documents：迭代项 ↔ 文档关联（需求转入时一并搬过来）；
 * - backlog_events：迭代项 append-only 事件流（状态流转/移动/提测等）；
 * - tickets.backlog_id：迭代项发起的工单（提测工单）关联；
 * - 预置系统「提测工单」定义并发布 v1（工单创建要求已发布版本）。
 */
export class BacklogOptimizations1799500000000 implements MigrationInterface {
  name = 'BacklogOptimizations1799500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "backlogs"
      ADD COLUMN IF NOT EXISTS "expectedOnlineAt" timestamptz
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "backlog_documents" (
        "id" SERIAL PRIMARY KEY,
        "backlogId" integer NOT NULL,
        "documentId" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_backlog_documents_backlogId_documentId"
      ON "backlog_documents" ("backlogId", "documentId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlog_documents_backlogId"
      ON "backlog_documents" ("backlogId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlog_documents_documentId"
      ON "backlog_documents" ("documentId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "backlog_events" (
        "id" SERIAL PRIMARY KEY,
        "backlogId" integer NOT NULL,
        "type" varchar(30) NOT NULL,
        "payload" json,
        "operator" varchar(100),
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_backlog_events_backlogId"
      ON "backlog_events" ("backlogId")
    `);

    await queryRunner.query(`
      ALTER TABLE "tickets"
      ADD COLUMN IF NOT EXISTS "backlogId" integer
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tickets_backlogId"
      ON "tickets" ("backlogId")
    `);

    // 预置系统「提测工单」定义，并直接发布 v1（无发布版本时无法创建工单）
    const existing = (await queryRunner.query(
      `SELECT "id" FROM "workflow_definitions" WHERE "code" = $1 LIMIT 1`,
      [RELEASE_TICKET_WORKFLOW.code],
    )) as Array<{ id: number }>;
    let definitionId: number;
    if (existing.length > 0) {
      definitionId = existing[0].id;
    } else {
      const inserted = (await queryRunner.query(
        `INSERT INTO "workflow_definitions"
          ("code", "category", "name", "description", "builtIn", "enabled", "draftDefinition", "latestPublishedVersion")
         VALUES ($1, $2, $3, $4, true, true, $5, 0)
         RETURNING "id"`,
        [
          RELEASE_TICKET_WORKFLOW.code,
          RELEASE_TICKET_WORKFLOW.category,
          RELEASE_TICKET_WORKFLOW.name,
          RELEASE_TICKET_WORKFLOW.description,
          JSON.stringify(RELEASE_TICKET_WORKFLOW.definition),
        ],
      )) as Array<{ id: number }>;
      definitionId = inserted[0].id;
    }
    const published = (await queryRunner.query(
      `SELECT "id" FROM "workflow_definition_versions"
       WHERE "definitionId" = $1 AND "version" = 1 LIMIT 1`,
      [definitionId],
    )) as Array<{ id: number }>;
    if (published.length === 0) {
      await queryRunner.query(
        `INSERT INTO "workflow_definition_versions"
          ("definitionId", "version", "name", "description", "definition")
         VALUES ($1, 1, $2, $3, $4)`,
        [
          definitionId,
          RELEASE_TICKET_WORKFLOW.name,
          RELEASE_TICKET_WORKFLOW.description,
          JSON.stringify(RELEASE_TICKET_WORKFLOW.definition),
        ],
      );
    }
    await queryRunner.query(
      `UPDATE "workflow_definitions"
       SET "latestPublishedVersion" = 1, "latestPublishedAt" = now(), "enabled" = true
       WHERE "id" = $1`,
      [definitionId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      DELETE FROM "workflow_definition_versions"
      WHERE "definitionId" IN (
        SELECT "id" FROM "workflow_definitions" WHERE "code" = $1
      )
    `,
      [RELEASE_TICKET_WORKFLOW.code],
    );
    await queryRunner.query(
      `DELETE FROM "workflow_definitions" WHERE "code" = $1`,
      [RELEASE_TICKET_WORKFLOW.code],
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tickets_backlogId"`);
    await queryRunner.query(
      `ALTER TABLE "tickets" DROP COLUMN IF EXISTS "backlogId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "backlog_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backlog_documents"`);
    await queryRunner.query(
      `ALTER TABLE "backlogs" DROP COLUMN IF EXISTS "expectedOnlineAt"`,
    );
  }
}

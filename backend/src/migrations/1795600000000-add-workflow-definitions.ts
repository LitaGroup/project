import { MigrationInterface, QueryRunner } from 'typeorm';
import { TEST_TICKET_WORKFLOW } from '../workflows/system-workflows';

/**
 * 工单定义：可发布的工作流定义与不可变版本。
 * 预置唯一的系统「测试工单」定义，网页仅允许编辑流程，不开放创建/删除。
 */
export class AddWorkflowDefinitions1795600000000 implements MigrationInterface {
  name = 'AddWorkflowDefinitions1795600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_definitions" (
        "id" SERIAL PRIMARY KEY,
        "code" varchar(64) NOT NULL UNIQUE,
        "category" varchar(64) NOT NULL,
        "name" varchar(100) NOT NULL,
        "description" text,
        "builtIn" boolean NOT NULL DEFAULT true,
        "enabled" boolean NOT NULL DEFAULT true,
        "draftDefinition" jsonb NOT NULL,
        "latestPublishedVersion" integer NOT NULL DEFAULT 0,
        "latestPublishedAt" timestamptz,
        "draftUpdatedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workflow_definitions_category"
      ON "workflow_definitions" ("category")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workflow_definition_versions" (
        "id" SERIAL PRIMARY KEY,
        "definitionId" integer NOT NULL,
        "version" integer NOT NULL,
        "name" varchar(100) NOT NULL,
        "description" text,
        "definition" jsonb NOT NULL,
        "publishedById" integer,
        "publishedByName" varchar(100),
        "publishedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workflow_definition_versions_definition_version"
      ON "workflow_definition_versions" ("definitionId", "version")
    `);

    await queryRunner.query(
      `INSERT INTO "workflow_definitions"
        ("code", "category", "name", "description", "builtIn", "enabled", "draftDefinition")
       VALUES ($1, $2, $3, $4, true, true, $5)
       ON CONFLICT DO NOTHING`,
      [
        TEST_TICKET_WORKFLOW.code,
        TEST_TICKET_WORKFLOW.category,
        TEST_TICKET_WORKFLOW.name,
        TEST_TICKET_WORKFLOW.description,
        JSON.stringify(TEST_TICKET_WORKFLOW.definition),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workflow_definition_versions"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workflow_definitions"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';
import { DEPLOY_TICKET_WORKFLOW } from '../workflows/system-workflows';

/**
 * 预置系统「发布工单」定义（code: deploy-ticket），与既有「测试工单」并列。
 */
export class AddDeployTicketWorkflow1795700000000 implements MigrationInterface {
  name = 'AddDeployTicketWorkflow1795700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "workflow_definitions"
        ("code", "category", "name", "description", "builtIn", "enabled", "draftDefinition")
       VALUES ($1, $2, $3, $4, true, true, $5)
       ON CONFLICT DO NOTHING`,
      [
        DEPLOY_TICKET_WORKFLOW.code,
        DEPLOY_TICKET_WORKFLOW.category,
        DEPLOY_TICKET_WORKFLOW.name,
        DEPLOY_TICKET_WORKFLOW.description,
        JSON.stringify(DEPLOY_TICKET_WORKFLOW.definition),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "workflow_definition_versions"
       WHERE "definitionId" IN (
         SELECT "id" FROM "workflow_definitions" WHERE "code" = $1
       )`,
      [DEPLOY_TICKET_WORKFLOW.code],
    );
    await queryRunner.query(
      `DELETE FROM "workflow_definitions" WHERE "code" = $1`,
      [DEPLOY_TICKET_WORKFLOW.code],
    );
  }
}

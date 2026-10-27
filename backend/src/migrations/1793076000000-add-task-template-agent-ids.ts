import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'task_templates';

/** 任务定义默认处理机器人由单个 agentId 改为多选 agentIds（simple-json 数组）。 */
export class AddTaskTemplateAgentIds1793076000000 implements MigrationInterface {
  name = 'AddTaskTemplateAgentIds1793076000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;

    const hasAgentId = await queryRunner.hasColumn(TABLE, 'agentId');
    const hasAgentIds = await queryRunner.hasColumn(TABLE, 'agentIds');
    if (!hasAgentIds) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN "agentIds" text NOT NULL DEFAULT '[]'`,
      );
    }
    if (hasAgentId) {
      await queryRunner.query(
        `UPDATE "${TABLE}" SET "agentIds" = '[' || "agentId" || ']' WHERE "agentId" IS NOT NULL AND "agentIds" = '[]'`,
      );
      await queryRunner.query(`ALTER TABLE "${TABLE}" DROP COLUMN "agentId"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;

    if (!(await queryRunner.hasColumn(TABLE, 'agentId'))) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN "agentId" int NULL`,
      );
    }
    if (await queryRunner.hasColumn(TABLE, 'agentIds')) {
      await queryRunner.query(
        `UPDATE "${TABLE}" SET "agentId" = (("agentIds"::jsonb)->>0)::int WHERE jsonb_array_length("agentIds"::jsonb) > 0`,
      );
      await queryRunner.query(`ALTER TABLE "${TABLE}" DROP COLUMN "agentIds"`);
    }
  }
}

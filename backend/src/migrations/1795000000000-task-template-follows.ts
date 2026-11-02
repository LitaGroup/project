import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务定义创建人与关注关系：
 * - task_templates 增加 createdById / createdByName，用于「我的任务定义」归属；
 * - 新增 task_template_follows 记录用户关注的任务定义，唯一约束 (templateId, userId)。
 * 无物理外键，删除任务定义时由应用层清理关注记录。
 */
export class TaskTemplateFollows1795000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "task_templates" ADD COLUMN IF NOT EXISTS "createdById" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_templates" ADD COLUMN IF NOT EXISTS "createdByName" varchar(100)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_template_follows" (
        "id" SERIAL PRIMARY KEY,
        "templateId" integer NOT NULL,
        "userId" integer NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_task_template_follows_template_user"
      ON "task_template_follows" ("templateId", "userId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_template_follows_templateId"
      ON "task_template_follows" ("templateId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_template_follows_userId"
      ON "task_template_follows" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_template_follows"`);
    await queryRunner.query(
      `ALTER TABLE "task_templates" DROP COLUMN IF EXISTS "createdByName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "task_templates" DROP COLUMN IF EXISTS "createdById"`,
    );
  }
}

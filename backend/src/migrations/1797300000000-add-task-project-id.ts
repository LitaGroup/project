import { MigrationInterface, QueryRunner } from 'typeorm';

/** 任务与项目的正式关联；同时回填已创建的项目开发交付任务。 */
export class AddTaskProjectId1797300000000 implements MigrationInterface {
  name = 'AddTaskProjectId1797300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    if (!(await queryRunner.hasColumn('tasks', 'projectId'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "projectId" integer NULL`,
      );
    }
    await queryRunner.query(
      `UPDATE "tasks"
       SET "projectId" = substring(trim("description") from '^项目ID：([0-9]+) 的实施交付$')::integer
       WHERE "templateId" = 7
         AND "projectId" IS NULL
         AND trim("description") ~ '^项目ID：[0-9]+ 的实施交付$'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tasks_projectId" ON "tasks" ("projectId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_projectId"`);
    if (await queryRunner.hasColumn('tasks', 'projectId')) {
      await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "projectId"`);
    }
  }
}

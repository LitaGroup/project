import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务列表按更新时间倒序（看板快照与 GET /api/tasks），补 updatedAt 索引，
 * 避免全表扫描后在内存排序。PostgreSQL btree 可反向扫描，普通升序索引即可支撑 DESC。
 */
export class AddTaskUpdatedAtIndex1798900000001 implements MigrationInterface {
  name = 'AddTaskUpdatedAtIndex1798900000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tasks_updatedAt" ON "tasks" ("updatedAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tasks_updatedAt"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'tasks';

/**
 * 任务提醒超时由「3 次提醒」改为「首次提醒满 7 天」，
 * 增加首次提醒时间；历史数据用最近提醒时间兜底。
 */
export class AddTaskFirstRemindedAt1793080000000 implements MigrationInterface {
  name = 'AddTaskFirstRemindedAt1793080000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;

    if (!(await queryRunner.hasColumn(TABLE, 'firstRemindedAt'))) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN "firstRemindedAt" timestamp NULL`,
      );
    }
    await queryRunner.query(
      `UPDATE "${TABLE}" SET "firstRemindedAt" = "lastRemindedAt" WHERE "firstRemindedAt" IS NULL AND "lastRemindedAt" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;
    if (await queryRunner.hasColumn(TABLE, 'firstRemindedAt')) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" DROP COLUMN "firstRemindedAt"`,
      );
    }
  }
}

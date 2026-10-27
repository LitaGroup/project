import { MigrationInterface, QueryRunner } from 'typeorm';

/** 平台直接识别分配无法匹配时使用的系统任务类型。 */
export class AddUnknownTaskType1793100000000 implements MigrationInterface {
  name = 'AddUnknownTaskType1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('task_types')) {
      await queryRunner.query(
        `INSERT INTO task_types (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [
          '未知任务',
          '平台无法匹配任务定义/类型对应机器人时自动归入，由系统未知任务定义（ID=6）接管',
        ],
      );
    }
    if (await queryRunner.hasTable('workers')) {
      if (!(await queryRunner.hasColumn('workers', 'systemKey'))) {
        await queryRunner.query(
          `ALTER TABLE "workers" ADD COLUMN "systemKey" varchar(50) NULL`,
        );
      }
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workers_systemKey" ON "workers" ("systemKey") WHERE "systemKey" IS NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('workers')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "UQ_workers_systemKey"`);
      if (await queryRunner.hasColumn('workers', 'systemKey')) {
        await queryRunner.query(
          `ALTER TABLE "workers" DROP COLUMN "systemKey"`,
        );
      }
    }
    if (await queryRunner.hasTable('task_types')) {
      await queryRunner.query(`DELETE FROM task_types WHERE name = $1`, [
        '未知任务',
      ]);
    }
  }
}

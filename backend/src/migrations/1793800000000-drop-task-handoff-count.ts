import { MigrationInterface, QueryRunner } from 'typeorm';

/** 任务文档去掉版本概念：复盘固定覆盖 REVIEW，不再记录报告版本数量。 */
export class DropTaskHandoffCount1793800000000 implements MigrationInterface {
  name = 'DropTaskHandoffCount1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('tasks')) &&
      (await queryRunner.hasColumn('tasks', 'handoffCount'))
    ) {
      await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "handoffCount"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('tasks')) &&
      !(await queryRunner.hasColumn('tasks', 'handoffCount'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "handoffCount" integer NOT NULL DEFAULT 0`,
      );
    }
  }
}

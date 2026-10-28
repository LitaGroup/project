import { MigrationInterface, QueryRunner } from 'typeorm';

/** 任务总结移交：记录任务内已成功生成报告数量，下一份版本号即该值。 */
export class AddTaskHandoffCount1793600000000 implements MigrationInterface {
  name = 'AddTaskHandoffCount1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('tasks')) &&
      !(await queryRunner.hasColumn('tasks', 'handoffCount'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "handoffCount" integer NOT NULL DEFAULT 0`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('tasks')) &&
      (await queryRunner.hasColumn('tasks', 'handoffCount'))
    ) {
      await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "handoffCount"`);
    }
  }
}

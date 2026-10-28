import { MigrationInterface, QueryRunner } from 'typeorm';

/** 验收不通过计数与超过 3 次后的任务负责人接管快照。 */
export class AddTaskAcceptanceEscalation1793900000000 implements MigrationInterface {
  name = 'AddTaskAcceptanceEscalation1793900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    if (!(await queryRunner.hasColumn('tasks', 'acceptRejectCount'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "acceptRejectCount" integer NOT NULL DEFAULT 0`,
      );
    }
    if (!(await queryRunner.hasColumn('tasks', 'ownerTakeoverAt'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "ownerTakeoverAt" timestamptz`,
      );
    }
    if (!(await queryRunner.hasColumn('tasks', 'ownerTakeoverUserId'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "ownerTakeoverUserId" integer`,
      );
    }
    if (!(await queryRunner.hasColumn('tasks', 'ownerTakeoverName'))) {
      await queryRunner.query(
        `ALTER TABLE "tasks" ADD COLUMN "ownerTakeoverName" varchar(100)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    for (const column of [
      'acceptRejectCount',
      'ownerTakeoverAt',
      'ownerTakeoverUserId',
      'ownerTakeoverName',
    ]) {
      if (await queryRunner.hasColumn('tasks', column)) {
        await queryRunner.query(`ALTER TABLE "tasks" DROP COLUMN "${column}"`);
      }
    }
  }
}

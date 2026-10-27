import { MigrationInterface, QueryRunner } from 'typeorm';

/** 机器人新增规范清单（standards）：规范库 README.md 引用，初始化时同步其目录到工位 .opencode/docs。 */
export class AddWorkerStandards1793200000000 implements MigrationInterface {
  name = 'AddWorkerStandards1793200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('workers')) &&
      !(await queryRunner.hasColumn('workers', 'standards'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "workers" ADD COLUMN "standards" text NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('workers')) &&
      (await queryRunner.hasColumn('workers', 'standards'))
    ) {
      await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "standards"`);
    }
  }
}

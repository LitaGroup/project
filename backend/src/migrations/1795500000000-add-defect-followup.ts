import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 机器人提测后的缺陷闭环：
 * - 提测记录保存发起机器人与来源任务；
 * - 缺陷保存来源提测与自动创建的处理任务。
 */
export class AddDefectFollowup1795500000000 implements MigrationInterface {
  name = 'AddDefectFollowup1795500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "project_releases" ADD COLUMN IF NOT EXISTS "workerId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_releases" ADD COLUMN IF NOT EXISTS "sourceTaskId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "releaseId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "defects" ADD COLUMN IF NOT EXISTS "followupTaskId" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_defects_releaseId" ON "defects" ("releaseId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_defects_followupTaskId" ON "defects" ("followupTaskId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_defects_followupTaskId"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_defects_releaseId"`);
    await queryRunner.query(
      `ALTER TABLE "defects" DROP COLUMN IF EXISTS "followupTaskId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "defects" DROP COLUMN IF EXISTS "releaseId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_releases" DROP COLUMN IF EXISTS "sourceTaskId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "project_releases" DROP COLUMN IF EXISTS "workerId"`,
    );
  }
}

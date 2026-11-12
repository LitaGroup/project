import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 机器人备用模型：主模型命中限额/限流/token 用尽时自动切换。
 * 三个字段均可空，空表示未配置备用模型（保持原有失败行为）。
 */
export class AddWorkerBackupModel1799100000000 implements MigrationInterface {
  name = 'AddWorkerBackupModel1799100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "backupProviderId" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "backupModelId" varchar(200)`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "backupVariant" varchar(50)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "backupVariant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "backupModelId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "backupProviderId"`,
    );
  }
}

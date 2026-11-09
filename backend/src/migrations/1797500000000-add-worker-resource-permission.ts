import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 机器人资源网关权限：write（全部资源）/ read（仅只读资源）/ none（无权限）。
 * 与 GitHub 权限相互独立，存量机器人与新机器人默认无权限，需管理员显式授权。
 */
export class AddWorkerResourcePermission1797500000000 implements MigrationInterface {
  name = 'AddWorkerResourcePermission1797500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'workers_resourcePermission_enum'
        ) THEN
          CREATE TYPE "workers_resourcePermission_enum" AS ENUM ('none', 'read', 'write');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN IF NOT EXISTS "resourcePermission"
      "workers_resourcePermission_enum" NOT NULL DEFAULT 'none'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "resourcePermission"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "workers_resourcePermission_enum"`,
    );
  }
}

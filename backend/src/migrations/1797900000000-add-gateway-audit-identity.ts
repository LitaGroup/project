import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 资源网关审计身份字段：
 * - identityType：worker（机器人）/ user（真人），存量行按 worker 处理；
 * - userId：真人对应的 users.id，机器人为空。
 *
 * 只新增可空/带默认值字段与索引，兼容存量审计数据；凭证获取仍只向机器人发放。
 */
export class AddGatewayAuditIdentity1797900000000 implements MigrationInterface {
  name = 'AddGatewayAuditIdentity1797900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "gateway_credential_audits"
      ADD COLUMN IF NOT EXISTS "identityType" varchar(20) NOT NULL DEFAULT 'worker'
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "gateway_credential_audits"
      ADD COLUMN IF NOT EXISTS "userId" integer
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.gateway_credential_audits') IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM pg_indexes
             WHERE schemaname = 'public'
               AND indexname = 'IDX_gateway_credential_audits_userId'
           )
        THEN
          CREATE INDEX "IDX_gateway_credential_audits_userId"
            ON "gateway_credential_audits" ("userId");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_gateway_credential_audits_userId"`,
    );
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "gateway_credential_audits"
      DROP COLUMN IF EXISTS "userId"
    `);
    await queryRunner.query(`
      ALTER TABLE IF EXISTS "gateway_credential_audits"
      DROP COLUMN IF EXISTS "identityType"
    `);
  }
}

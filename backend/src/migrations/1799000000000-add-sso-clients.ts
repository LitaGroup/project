import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 单点登录（OAuth2 授权码 IdP）：
 * - sso_clients：管理区「SSO 应用」登记的接入方（clientId/secret 只写不回显 + 回调地址白名单）；
 * - sso_codes：一次性授权码（10 分钟有效，绑定 user / client / redirect_uri）。
 * 无物理外键，关联由应用层维护。
 */
export class AddSsoClients1799000000000 implements MigrationInterface {
  name = 'AddSsoClients1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sso_clients" (
        "id" SERIAL PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "clientId" varchar(64) NOT NULL,
        "clientSecret" varchar(128) NOT NULL,
        "redirectUris" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "remark" varchar(500),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sso_clients_clientId"
      ON "sso_clients" ("clientId")
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sso_codes" (
        "id" SERIAL PRIMARY KEY,
        "code" varchar(64) NOT NULL,
        "clientId" varchar(64) NOT NULL,
        "userId" int NOT NULL,
        "redirectUri" varchar(500) NOT NULL,
        "expiresAt" timestamptz NOT NULL,
        "usedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sso_codes_code"
      ON "sso_codes" ("code")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sso_codes_clientId"
      ON "sso_codes" ("clientId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_sso_codes_userId"
      ON "sso_codes" ("userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "sso_codes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sso_clients"`);
  }
}

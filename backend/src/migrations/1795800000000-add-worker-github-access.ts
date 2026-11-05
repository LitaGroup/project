import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OP Gateway：
 * - workers 增加 GitHub 权限（可配置两档：开发权限（默认）/ 发布权限；真人/个人 AGENT 固定无权限）；
 * - 全平台仅两条档位凭证记录（开发权限 / 发布权限），PAT 以 AES-256-GCM 密文保存；
 * - 记录 Gateway 凭证获取审计（不保存 Token/PAT）。
 */
export class AddWorkerGithubAccess1795800000000 implements MigrationInterface {
  name = 'AddWorkerGithubAccess1795800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workers_githubPermission_enum') THEN
           CREATE TYPE "workers_githubPermission_enum" AS ENUM ('none', 'develop', 'release');
         END IF;
       END $$;`,
    );
    // 早期版本曾用 write 表示发布权限；兼容已按旧版本建库的环境，值不存在时忽略
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TYPE "workers_githubPermission_enum" RENAME VALUE 'write' TO 'release';
       EXCEPTION WHEN OTHERS THEN NULL;
       END $$;`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" ADD COLUMN IF NOT EXISTS "githubPermission" "workers_githubPermission_enum" NOT NULL DEFAULT 'develop'`,
    );
    // 个人 AGENT 不承接任务，第一期固定无权限；真人机器人默认开发权限（可在管理区调整）
    await queryRunner.query(
      `UPDATE "workers"
         SET "githubPermission" = 'none'
       WHERE "personalAgentUserId" IS NOT NULL`,
    );

    // 早期开发库可能创建过按机器人存凭证的表；统一清理，档位凭证只保留两条
    await queryRunner.query(`DROP TABLE IF EXISTS "worker_github_credentials"`);

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "github_permission_credentials" (
         "id" SERIAL NOT NULL,
         "permission" varchar(20) NOT NULL,
         "githubAccount" varchar(100),
         "patCiphertext" text NOT NULL,
         "patIv" text NOT NULL,
         "patAuthTag" text NOT NULL,
         "keyVersion" varchar(30) NOT NULL,
         "enabled" boolean NOT NULL DEFAULT true,
         "rotatedAt" timestamptz,
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         "updatedAt" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "PK_github_permission_credentials" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_github_permission_credentials_permission"
         ON "github_permission_credentials" ("permission")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "gateway_credential_audits" (
         "id" SERIAL NOT NULL,
         "leaseId" varchar(80),
         "workerId" integer NOT NULL,
         "credentialId" integer,
         "credentialType" varchar(60) NOT NULL,
         "resource" varchar(200) NOT NULL,
         "action" varchar(60) NOT NULL,
         "allowed" boolean NOT NULL,
         "denyReason" varchar(80),
         "requestId" varchar(120),
         "createdAt" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "PK_gateway_credential_audits" PRIMARY KEY ("id")
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gateway_credential_audits_workerId"
         ON "gateway_credential_audits" ("workerId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gateway_credential_audits_leaseId"
         ON "gateway_credential_audits" ("leaseId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_gateway_credential_audits_leaseId"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_gateway_credential_audits_workerId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "gateway_credential_audits"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_github_permission_credentials_permission"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "github_permission_credentials"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "githubPermission"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "workers_githubPermission_enum"`,
    );
  }
}

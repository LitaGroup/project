import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OP Gateway 档位凭证模型收敛：
 * - GitHub 权限枚举统一为 none / develop / release（兼容早期开发库的 write）；
 * - 清理早期按机器人保存凭证的 worker_github_credentials；
 * - 确保 github_permission_credentials 仅保存 开发权限 / 发布权限 两档凭证。
 */
export class ConsolidateGithubPermissionCredentials1795900000000 implements MigrationInterface {
  name = 'ConsolidateGithubPermissionCredentials1795900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 早期开发库可能已按 write 建库；枚举值不存在时忽略
    await queryRunner.query(
      `DO $$ BEGIN
         ALTER TYPE "workers_githubPermission_enum" RENAME VALUE 'write' TO 'release';
       EXCEPTION WHEN OTHERS THEN NULL;
       END $$;`,
    );
    await queryRunner.query(
      `ALTER TYPE "workers_githubPermission_enum" ADD VALUE IF NOT EXISTS 'release' AFTER 'develop'`,
    );

    // 早期模型按机器人保存 PAT；档位模型改为全平台两条，旧表不再保留
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
    // 兼容早期档位表可能写入过 write
    await queryRunner.query(
      `UPDATE "github_permission_credentials"
         SET "permission" = 'release'
       WHERE "permission" = 'write'`,
    );
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    // 该迁移收敛本地历史模型，无法安全恢复已删除的按机器人凭证；保持 no-op
    void queryRunner;
    return Promise.resolve();
  }
}

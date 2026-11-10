import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 取消用户级 agent 令牌：个人调用统一使用其绑定真人机器人的 workers.agentToken。
 *
 * 迁移策略：先把 users.agentToken 搬到对应真人机器人的 workers.agentToken
 * （个人中心已下发的令牌继续有效，个人 AGENT 与真人共用同一令牌），再删除用户列。
 * 若真人机器人已有令牌，以用户已分发的令牌为准，保证外部 agent 配置不失效。
 */
export class RemoveUserAgentToken1797900000000 implements MigrationInterface {
  name = 'RemoveUserAgentToken1797900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    const hasWorkers = await queryRunner.hasTable('workers');
    if (
      hasUsers &&
      hasWorkers &&
      (await queryRunner.hasColumn('users', 'agentToken')) &&
      (await queryRunner.hasColumn('workers', 'agentToken')) &&
      (await queryRunner.hasColumn('workers', 'humanUserId'))
    ) {
      await queryRunner.query(`
        UPDATE "workers" w
        SET "agentToken" = u."agentToken"
        FROM "users" u
        WHERE w."humanUserId" = u.id
          AND u."agentToken" IS NOT NULL
      `);
    }
    if (
      hasWorkers &&
      (await queryRunner.hasColumn('workers', 'personalAgentUserId'))
    ) {
      // 个人 AGENT 不再单独发放令牌，统一复用其主人真人机器人的令牌
      await queryRunner.query(`
        UPDATE "workers"
        SET "agentToken" = NULL
        WHERE "personalAgentUserId" IS NOT NULL
      `);
    }
    if (hasUsers && (await queryRunner.hasColumn('users', 'agentToken'))) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_agentToken"`);
      await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "agentToken"`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const hasUsers = await queryRunner.hasTable('users');
    if (!hasUsers) return;
    if (!(await queryRunner.hasColumn('users', 'agentToken'))) {
      await queryRunner.query(
        `ALTER TABLE "users" ADD COLUMN "agentToken" varchar(64)`,
      );
    }
    if (
      (await queryRunner.hasTable('workers')) &&
      (await queryRunner.hasColumn('workers', 'agentToken')) &&
      (await queryRunner.hasColumn('workers', 'humanUserId'))
    ) {
      await queryRunner.query(`
        UPDATE "users" u
        SET "agentToken" = w."agentToken"
        FROM "workers" w
        WHERE w."humanUserId" = u.id
          AND w."agentToken" IS NOT NULL
      `);
    }
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_agentToken" ON "users" ("agentToken")`,
    );
  }
}

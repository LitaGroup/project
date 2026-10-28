import { MigrationInterface, QueryRunner } from 'typeorm';

/** 机器人独立访问令牌：用于严格校验「当前任务执行机器人」的 Agent 接口。 */
export class AddWorkerAgentToken1793700000000 implements MigrationInterface {
  name = 'AddWorkerAgentToken1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (
      (await queryRunner.hasTable('workers')) &&
      !(await queryRunner.hasColumn('workers', 'agentToken'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "workers" ADD COLUMN "agentToken" varchar(64)`,
      );
    }
    if (await queryRunner.hasTable('workers')) {
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_workers_agentToken" ON "workers" ("agentToken")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('workers')) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_workers_agentToken"`);
      if (await queryRunner.hasColumn('workers', 'agentToken')) {
        await queryRunner.query(
          `ALTER TABLE "workers" DROP COLUMN "agentToken"`,
        );
      }
    }
  }
}

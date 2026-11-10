import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 管理区「模型配置」：
 * - model_scenarios：固定场景（如工单和任务标题命名）的 OpenAI 兼容模型连接；
 * - apiKey 明文落库、select:false，只写不回显（列表仅返回 hasApiKey）。
 */
export class AddModelScenarios1798100000000 implements MigrationInterface {
  name = 'AddModelScenarios1798100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'model_scenarios_thinking_enum'
        ) THEN
          CREATE TYPE "model_scenarios_thinking_enum" AS ENUM ('off', 'low', 'medium', 'high');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "model_scenarios" (
        "id" SERIAL PRIMARY KEY,
        "scenario" varchar(100) NOT NULL,
        "baseUrl" varchar(500),
        "apiKey" varchar(512),
        "model" varchar(200),
        "thinking" "model_scenarios_thinking_enum" NOT NULL DEFAULT 'low',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_model_scenarios_scenario"
      ON "model_scenarios" ("scenario")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "model_scenarios"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "model_scenarios_thinking_enum"`,
    );
  }
}

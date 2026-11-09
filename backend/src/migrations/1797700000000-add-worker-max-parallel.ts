import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 机器人并行执行上限：同一时刻允许处于「进行中-执行中」的任务数。
 * 仅 AI（runtime=opencode）机器人生效，默认 3；设为 1 即恢复串行行为。
 * 真人机器人不受此限制，仍可并行执行多个任务。
 */
export class AddWorkerMaxParallel1797700000000 implements MigrationInterface {
  name = 'AddWorkerMaxParallel1797700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "workers"
      ADD COLUMN IF NOT EXISTS "maxParallelTasks" integer NOT NULL DEFAULT 3
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workers" DROP COLUMN IF EXISTS "maxParallelTasks"`,
    );
  }
}

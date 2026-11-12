import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务外部事件表：承接 lita-proxy 工单状态回调，先落库再唤醒任务会话。
 * 同一任务 + 工单 + 状态唯一，回调重试天然幂等；投递失败按退避重试。
 */
export class AddTaskExternalEvents1799300000000 implements MigrationInterface {
  name = 'AddTaskExternalEvents1799300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_external_events" (
        "id" SERIAL PRIMARY KEY,
        "taskId" integer NOT NULL,
        "source" varchar(30) NOT NULL,
        "externalTicketId" integer NOT NULL,
        "eventType" varchar(60) NOT NULL,
        "externalStatus" varchar(30) NOT NULL,
        "payload" json,
        "deliveryStatus" varchar(20) NOT NULL DEFAULT 'queued',
        "attempts" integer NOT NULL DEFAULT 0,
        "lastAttemptAt" timestamptz,
        "nextRetryAt" timestamptz,
        "lastError" text,
        "deliveredAt" timestamptz,
        "processedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_task_external_events_ticket_status"
      ON "task_external_events" ("taskId", "source", "externalTicketId", "externalStatus")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_external_events_taskId"
      ON "task_external_events" ("taskId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_external_events_delivery"
      ON "task_external_events" ("deliveryStatus", "nextRetryAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "task_external_events"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 任务话题轮次队列：多话题同时触发同一任务时按 FIFO 投递，
 * 机器人输出按本轮 topicId 归位，避免落到最后活动话题。
 */
export class AddTopicTaskTurns1799700000000 implements MigrationInterface {
  name = 'AddTopicTaskTurns1799700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_task_turns" (
        "id" SERIAL PRIMARY KEY,
        "taskId" integer NOT NULL,
        "topicId" integer NOT NULL,
        "replyId" integer,
        "content" text NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'queued',
        "actorWorkerId" integer,
        "actorName" varchar(120),
        "error" text,
        "startedAt" timestamptz,
        "finishedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_task_turns_task"
      ON "discussion_task_turns" ("taskId", "status", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_task_turns_topic"
      ON "discussion_task_turns" ("topicId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_task_turns"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 话题（Topic）：主体（灵感/迭代项/知识/任务/工单）下的统一讨论区。
 * - discussion_topics：主帖/话题，默认主话题 isDefault=true；
 * - discussion_replies：回复（含机器人回复、问答答案）；
 * - discussion_reads：个人已读位置；
 * - discussion_notifications：@机器人/回复等站内通知；
 * - discussion_task_contexts：任务当前机器人输出来源话题。
 * 无物理外键：主体删除时由应用层清理。
 */
export class AddTopics1799600000000 implements MigrationInterface {
  name = 'AddTopics1799600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_topics" (
        "id" SERIAL PRIMARY KEY,
        "subjectType" varchar(20) NOT NULL,
        "subjectId" varchar(120) NOT NULL,
        "title" varchar(200),
        "content" text NOT NULL DEFAULT '',
        "type" varchar(20) NOT NULL DEFAULT 'content',
        "status" varchar(20) NOT NULL DEFAULT 'open',
        "tags" jsonb NOT NULL DEFAULT '[]',
        "blocking" boolean NOT NULL DEFAULT false,
        "isDefault" boolean NOT NULL DEFAULT false,
        "pinned" boolean NOT NULL DEFAULT false,
        "locked" boolean NOT NULL DEFAULT false,
        "authorType" varchar(20) NOT NULL DEFAULT 'user',
        "authorId" integer,
        "authorName" varchar(120),
        "authorAvatarUrl" varchar(500),
        "images" jsonb,
        "mentions" jsonb,
        "metadata" jsonb,
        "replyCount" integer NOT NULL DEFAULT 0,
        "lastReplyAt" timestamptz,
        "lastReplyByName" varchar(120),
        "deletedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_topics_subject"
      ON "discussion_topics" ("subjectType", "subjectId", "lastReplyAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_topics_status"
      ON "discussion_topics" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_topics_type"
      ON "discussion_topics" ("type")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_discussion_topics_isDefault"
      ON "discussion_topics" ("subjectType", "subjectId")
      WHERE "isDefault" = true AND "deletedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_replies" (
        "id" SERIAL PRIMARY KEY,
        "topicId" integer NOT NULL,
        "content" text NOT NULL DEFAULT '',
        "authorType" varchar(20) NOT NULL DEFAULT 'user',
        "authorId" integer,
        "authorName" varchar(120),
        "authorAvatarUrl" varchar(500),
        "images" jsonb,
        "mentions" jsonb,
        "metadata" jsonb,
        "status" varchar(20) NOT NULL DEFAULT 'complete',
        "sourceMessageId" varchar(200),
        "deletedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_replies_topic"
      ON "discussion_replies" ("topicId", "id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_discussion_replies_source"
      ON "discussion_replies" ("topicId", "sourceMessageId")
      WHERE "sourceMessageId" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_reads" (
        "id" SERIAL PRIMARY KEY,
        "topicId" integer NOT NULL,
        "userId" integer NOT NULL,
        "lastReadReplyId" integer NOT NULL DEFAULT 0,
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_discussion_reads_topic_user"
      ON "discussion_reads" ("topicId", "userId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_notifications" (
        "id" SERIAL PRIMARY KEY,
        "userId" integer NOT NULL,
        "type" varchar(20) NOT NULL,
        "topicId" integer NOT NULL,
        "replyId" integer,
        "title" varchar(200) NOT NULL,
        "content" text,
        "readAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_notifications_user"
      ON "discussion_notifications" ("userId", "readAt", "id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_discussion_notifications_topic"
      ON "discussion_notifications" ("topicId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "discussion_task_contexts" (
        "id" SERIAL PRIMARY KEY,
        "taskId" integer NOT NULL,
        "activeTopicId" integer,
        "activeTopicTitle" varchar(200),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_discussion_task_contexts_task"
      ON "discussion_task_contexts" ("taskId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_task_contexts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_notifications"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_reads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_replies"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "discussion_topics"`);
  }
}

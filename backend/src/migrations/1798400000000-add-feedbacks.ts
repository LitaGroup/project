import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 用户反馈（业务分区「反馈」）：
 * - feedbacks：面向全员的 BUG REPORT / 建议 / 其它，独立于研发内部缺陷；
 *   枚举类型命名遵循 {table}_{column}_enum，与 TypeORM 实体 `type: 'enum'` 推导一致。
 */
export class AddFeedbacks1798400000000 implements MigrationInterface {
  name = 'AddFeedbacks1798400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'feedbacks_type_enum'
        ) THEN
          CREATE TYPE "feedbacks_type_enum" AS ENUM ('BUG', '建议', '其它');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'feedbacks_status_enum'
        ) THEN
          CREATE TYPE "feedbacks_status_enum" AS ENUM ('待处理', '处理中', '已解决', '已关闭');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feedbacks" (
        "id" SERIAL PRIMARY KEY,
        "title" varchar(200) NOT NULL,
        "type" "feedbacks_type_enum" NOT NULL DEFAULT 'BUG',
        "status" "feedbacks_status_enum" NOT NULL DEFAULT '待处理',
        "content" text NOT NULL,
        "images" json,
        "reporterId" integer,
        "reporterName" varchar(100),
        "handlerName" varchar(100),
        "handleNote" text,
        "resolvedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_feedbacks_reporterId"
      ON "feedbacks" ("reporterId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "feedbacks"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "feedbacks_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "feedbacks_type_enum"`);
  }
}

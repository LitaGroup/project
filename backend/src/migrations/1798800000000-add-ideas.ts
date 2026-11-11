import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 灵感（业务分区「灵感」）：
 * - ideas：收集想法/创意/待办/建议；构思期全员可编辑，采纳/废弃后仅管理员可改；
 * - 采纳时在需求池新建或关联需求，`projectId` 为应用层软引用（不建物理外键）；
 * - 枚举类型命名遵循 {table}_{column}_enum，与 TypeORM 实体 `type: 'enum'` 推导一致。
 */
export class AddIdeas1798800000000 implements MigrationInterface {
  name = 'AddIdeas1798800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'ideas_type_enum'
        ) THEN
          CREATE TYPE "ideas_type_enum" AS ENUM ('想法', '创意', '待办', '建议', '其它');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'ideas_status_enum'
        ) THEN
          CREATE TYPE "ideas_status_enum" AS ENUM ('构思', '废弃', '采纳');
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ideas" (
        "id" SERIAL PRIMARY KEY,
        "title" varchar(200) NOT NULL,
        "type" "ideas_type_enum" NOT NULL DEFAULT '想法',
        "status" "ideas_status_enum" NOT NULL DEFAULT '构思',
        "content" text NOT NULL DEFAULT '',
        "images" json,
        "creatorId" integer,
        "creatorName" varchar(100),
        "projectId" integer,
        "adoptedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ideas_creatorId"
      ON "ideas" ("creatorId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ideas_projectId"
      ON "ideas" ("projectId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ideas"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ideas_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "ideas_type_enum"`);
  }
}

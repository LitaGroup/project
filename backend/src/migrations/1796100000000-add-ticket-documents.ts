import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 工单交付文档：任务机器人可把任务文档以链接或正文形式交付给所属工单，
 * 并支持后续更新、删除。链接与正文互斥，由数据库约束兜底。
 */
export class AddTicketDocuments1796100000000 implements MigrationInterface {
  name = 'AddTicketDocuments1796100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "ticket_documents" (
        "id" SERIAL PRIMARY KEY,
        "ticketId" integer NOT NULL,
        "sourceTaskId" integer NOT NULL,
        "sourceTaskCode" varchar(50) NOT NULL,
        "title" varchar(200) NOT NULL,
        "format" varchar(10) NOT NULL,
        "url" text,
        "content" text,
        "createdByWorkerId" integer NOT NULL,
        "createdByName" varchar(100) NOT NULL,
        "updatedByName" varchar(100),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_ticket_documents_format"
          CHECK (
            ("format" = 'link' AND "url" IS NOT NULL AND "content" IS NULL)
            OR
            ("format" = 'content' AND "content" IS NOT NULL AND "url" IS NULL)
          )
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ticket_documents_ticketId"
      ON "ticket_documents" ("ticketId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ticket_documents_sourceTaskId"
      ON "ticket_documents" ("sourceTaskId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "ticket_documents"`);
  }
}

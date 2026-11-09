import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'feishu_bot_project_chats';

/**
 * 项目交付沟通群：项目任务创建后建飞书群，同步根任务与直接子任务状态，
 * 根任务终态 7 天后自动解散。无物理外键，任务/项目清理由应用层负责。
 */
export class AddFeishuBotProjectChats1797600000000 implements MigrationInterface {
  name = 'AddFeishuBotProjectChats1797600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) return;
    await queryRunner.query(`
      CREATE TABLE "${TABLE}" (
        "id" serial PRIMARY KEY,
        "projectId" int NOT NULL,
        "taskId" int NOT NULL,
        "officialConfigId" int NOT NULL,
        "chatId" varchar(100) NULL,
        "state" varchar(20) NOT NULL DEFAULT 'creating',
        "name" varchar(120) NOT NULL,
        "projectName" varchar(200) NOT NULL,
        "memberUserIds" text NOT NULL DEFAULT '[]',
        "memberNames" text NOT NULL DEFAULT '[]',
        "botIds" text NOT NULL DEFAULT '[]',
        "lastStatuses" text NOT NULL DEFAULT '{}',
        "finishedAt" timestamptz NULL,
        "finishedNotified" boolean NOT NULL DEFAULT false,
        "destroyAfter" timestamptz NULL,
        "attempts" int NOT NULL DEFAULT 0,
        "lastError" text NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_feishu_bot_project_chats_taskId" ON "${TABLE}" ("taskId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feishu_bot_project_chats_projectId" ON "${TABLE}" ("projectId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feishu_bot_project_chats_chatId" ON "${TABLE}" ("chatId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_feishu_bot_project_chats_state" ON "${TABLE}" ("state")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

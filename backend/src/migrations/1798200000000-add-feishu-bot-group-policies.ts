import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/**
 * 机器人外部群策略与记录：
 * - feishu_bot_configs.botOpenId：机器人自身 open_id（识别群内 @机器人）；
 * - feishu_bot_groups：机器人被拉入的外部群（不含任务群/项目沟通群）与单群策略；
 * - feishu_bot_group_records：群消息/回复/进群/出群时间线记录。
 */
export class AddFeishuBotGroupPolicies1798200000000 implements MigrationInterface {
  name = 'AddFeishuBotGroupPolicies1798200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('feishu_bot_configs'))) return;
    if (!(await queryRunner.hasColumn('feishu_bot_configs', 'botOpenId'))) {
      await queryRunner.query(
        `ALTER TABLE "feishu_bot_configs" ADD COLUMN "botOpenId" varchar(100)`,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_groups'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_groups',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'configId', type: 'int' },
            { name: 'chatId', type: 'varchar', length: '100' },
            { name: 'name', type: 'varchar', length: '200', isNullable: true },
            { name: 'policy', type: 'varchar', length: '20', isNullable: true },
            { name: 'joinedAt', type: 'timestamptz', default: 'now()' },
            { name: 'leftAt', type: 'timestamptz', isNullable: true },
            { name: 'lastMessageAt', type: 'timestamptz', isNullable: true },
            { name: 'messageCount', type: 'int', default: 0 },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
            { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'UQ_feishu_bot_groups_config_chat',
              columnNames: ['configId', 'chatId'],
              isUnique: true,
            },
            {
              name: 'IDX_feishu_bot_groups_configId',
              columnNames: ['configId'],
            },
            { name: 'IDX_feishu_bot_groups_chatId', columnNames: ['chatId'] },
          ],
        }),
        true,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_group_records'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_group_records',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'configId', type: 'int' },
            { name: 'groupId', type: 'int' },
            { name: 'kind', type: 'varchar', length: '20' },
            {
              name: 'messageId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'senderOpenId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'senderName',
              type: 'varchar',
              length: '120',
              isNullable: true,
            },
            { name: 'senderUserId', type: 'int', isNullable: true },
            {
              name: 'messageType',
              type: 'varchar',
              length: '30',
              isNullable: true,
            },
            { name: 'content', type: 'text', isNullable: true },
            {
              name: 'decision',
              type: 'varchar',
              length: '20',
              isNullable: true,
            },
            { name: 'error', type: 'text', isNullable: true },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'IDX_feishu_bot_group_records_group',
              columnNames: ['groupId', 'id'],
            },
            {
              name: 'IDX_feishu_bot_group_records_configId',
              columnNames: ['configId'],
            },
            {
              name: 'IDX_feishu_bot_group_records_createdAt',
              columnNames: ['createdAt'],
            },
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('feishu_bot_group_records')) {
      await queryRunner.dropTable('feishu_bot_group_records');
    }
    if (await queryRunner.hasTable('feishu_bot_groups')) {
      await queryRunner.dropTable('feishu_bot_groups');
    }
    if (
      (await queryRunner.hasTable('feishu_bot_configs')) &&
      (await queryRunner.hasColumn('feishu_bot_configs', 'botOpenId'))
    ) {
      await queryRunner.query(
        `ALTER TABLE "feishu_bot_configs" DROP COLUMN "botOpenId"`,
      );
    }
  }
}

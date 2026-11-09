import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/** 飞书接入：应用配置 / 用户身份映射 / 提问卡片 / 事件去重 / 任务群绑定 */
export class AddFeishuBot1797100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('feishu_bot_configs'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_configs',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'kind', type: 'varchar', length: '20' },
            { name: 'workerId', type: 'int', isNullable: true },
            { name: 'name', type: 'varchar', length: '120', isNullable: true },
            { name: 'appId', type: 'varchar', length: '100' },
            { name: 'secretCiphertext', type: 'text' },
            { name: 'secretIv', type: 'text' },
            { name: 'secretAuthTag', type: 'text' },
            { name: 'keyVersion', type: 'varchar', length: '30' },
            {
              name: 'verificationTokenCiphertext',
              type: 'text',
              isNullable: true,
            },
            { name: 'verificationTokenIv', type: 'text', isNullable: true },
            {
              name: 'verificationTokenAuthTag',
              type: 'text',
              isNullable: true,
            },
            { name: 'encryptKeyCiphertext', type: 'text', isNullable: true },
            { name: 'encryptKeyIv', type: 'text', isNullable: true },
            { name: 'encryptKeyAuthTag', type: 'text', isNullable: true },
            { name: 'policy', type: 'jsonb', default: "'{}'" },
            { name: 'enabled', type: 'boolean', default: true },
            { name: 'boundAt', type: 'timestamptz', isNullable: true },
            { name: 'lastVerifiedAt', type: 'timestamptz', isNullable: true },
            { name: 'lastError', type: 'text', isNullable: true },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
            { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            { name: 'IDX_feishu_bot_configs_kind', columnNames: ['kind'] },
            {
              name: 'UQ_feishu_bot_configs_workerId',
              columnNames: ['workerId'],
              isUnique: true,
            },
            {
              name: 'UQ_feishu_bot_configs_appId',
              columnNames: ['appId'],
              isUnique: true,
            },
          ],
        }),
        true,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_identities'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_identities',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'configId', type: 'int' },
            { name: 'openId', type: 'varchar', length: '100' },
            {
              name: 'unionId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            { name: 'userId', type: 'int' },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
            { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'UQ_feishu_bot_identities_openId',
              columnNames: ['configId', 'openId'],
              isUnique: true,
            },
            {
              name: 'IDX_feishu_bot_identities_userId',
              columnNames: ['userId'],
            },
          ],
        }),
        true,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_cards'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_cards',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'configId', type: 'int' },
            { name: 'userId', type: 'int' },
            { name: 'workerId', type: 'int' },
            { name: 'scope', type: 'varchar', length: '120' },
            {
              name: 'chatId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'messageId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            { name: 'questionId', type: 'varchar', length: '100' },
            {
              name: 'state',
              type: 'varchar',
              length: '20',
              default: "'pending'",
            },
            { name: 'questions', type: 'jsonb' },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
            { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'IDX_feishu_bot_cards_question',
              columnNames: ['scope', 'questionId'],
            },
            { name: 'IDX_feishu_bot_cards_userId', columnNames: ['userId'] },
          ],
        }),
        true,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_events'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_events',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'eventId', type: 'varchar', length: '120' },
            { name: 'configId', type: 'int' },
            { name: 'type', type: 'varchar', length: '80', isNullable: true },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'UQ_feishu_bot_events_eventId',
              columnNames: ['eventId'],
              isUnique: true,
            },
          ],
        }),
        true,
      );
    }

    if (!(await queryRunner.hasTable('feishu_bot_task_chats'))) {
      await queryRunner.createTable(
        new Table({
          name: 'feishu_bot_task_chats',
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'taskId', type: 'int' },
            { name: 'officialConfigId', type: 'int' },
            {
              name: 'chatId',
              type: 'varchar',
              length: '100',
              isNullable: true,
            },
            {
              name: 'state',
              type: 'varchar',
              length: '20',
              default: "'creating'",
            },
            { name: 'aiSide', type: 'varchar', length: '20' },
            { name: 'humanUserId', type: 'int' },
            { name: 'humanName', type: 'varchar', length: '120' },
            { name: 'aiWorkerId', type: 'int' },
            { name: 'aiWorkerName', type: 'varchar', length: '120' },
            { name: 'taskCode', type: 'varchar', length: '40' },
            { name: 'taskTitle', type: 'varchar', length: '220' },
            { name: 'finishedAt', type: 'timestamptz', isNullable: true },
            { name: 'finishedNotified', type: 'boolean', default: false },
            { name: 'destroyAfter', type: 'timestamptz', isNullable: true },
            { name: 'attempts', type: 'int', default: 0 },
            { name: 'lastError', type: 'text', isNullable: true },
            { name: 'createdAt', type: 'timestamptz', default: 'now()' },
            { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
          ],
          indices: [
            {
              name: 'UQ_feishu_bot_task_chats_taskId',
              columnNames: ['taskId'],
              isUnique: true,
            },
            {
              name: 'IDX_feishu_bot_task_chats_chatId',
              columnNames: ['chatId'],
            },
            {
              name: 'IDX_feishu_bot_task_chats_state',
              columnNames: ['state'],
            },
          ],
        }),
        true,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'feishu_bot_task_chats',
      'feishu_bot_events',
      'feishu_bot_cards',
      'feishu_bot_identities',
      'feishu_bot_configs',
    ]) {
      if (await queryRunner.hasTable(table)) {
        await queryRunner.dropTable(table);
      }
    }
  }
}

import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

const TASKS = 'tasks';
const MESSAGES = 'task_messages';

/** 任务详情：任务定义关联/名称快照 + 多轮对话消息持久化。 */
export class AddTaskDetailAndMessages1793090000000 implements MigrationInterface {
  name = 'AddTaskDetailAndMessages1793090000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(TASKS)) {
      if (!(await queryRunner.hasColumn(TASKS, 'templateId'))) {
        await queryRunner.query(
          `ALTER TABLE "${TASKS}" ADD COLUMN "templateId" int NULL`,
        );
      }
      if (!(await queryRunner.hasColumn(TASKS, 'templateName'))) {
        await queryRunner.query(
          `ALTER TABLE "${TASKS}" ADD COLUMN "templateName" varchar(100) NULL`,
        );
      }
    }

    if (!(await queryRunner.hasTable(MESSAGES))) {
      await queryRunner.createTable(
        new Table({
          name: MESSAGES,
          columns: [
            {
              name: 'id',
              type: 'int',
              isPrimary: true,
              isGenerated: true,
              generationStrategy: 'increment',
            },
            { name: 'taskId', type: 'int' },
            { name: 'messageKey', type: 'varchar', length: '200' },
            { name: 'role', type: 'varchar', length: '20' },
            { name: 'sender', type: 'text' },
            { name: 'content', type: 'text' },
            { name: 'reasoning', type: 'text', isNullable: true },
            { name: 'status', type: 'varchar', length: '20' },
            { name: 'kind', type: 'varchar', length: '20' },
            { name: 'tools', type: 'text', isNullable: true },
            { name: 'question', type: 'text', isNullable: true },
            { name: 'meta', type: 'text', isNullable: true },
            {
              name: 'createdAt',
              type: 'timestamp',
              default: 'now()',
            },
            {
              name: 'updatedAt',
              type: 'timestamp',
              default: 'now()',
            },
          ],
        }),
        true,
      );
      await queryRunner.createIndex(
        MESSAGES,
        new TableIndex({
          name: 'IDX_task_messages_taskId',
          columnNames: ['taskId'],
        }),
      );
      await queryRunner.createIndex(
        MESSAGES,
        new TableIndex({
          name: 'UQ_task_messages_taskId_messageKey',
          columnNames: ['taskId', 'messageKey'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable(MESSAGES)) {
      await queryRunner.dropTable(MESSAGES);
    }
    if (await queryRunner.hasTable(TASKS)) {
      if (await queryRunner.hasColumn(TASKS, 'templateName')) {
        await queryRunner.query(
          `ALTER TABLE "${TASKS}" DROP COLUMN "templateName"`,
        );
      }
      if (await queryRunner.hasColumn(TASKS, 'templateId')) {
        await queryRunner.query(
          `ALTER TABLE "${TASKS}" DROP COLUMN "templateId"`,
        );
      }
    }
  }
}

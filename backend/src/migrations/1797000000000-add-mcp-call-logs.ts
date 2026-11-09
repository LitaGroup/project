import { MigrationInterface, QueryRunner, Table } from 'typeorm';

/** MCP 机器人调用审计表：外部 Agent 每次 bot_call/bot_answer 终态后落一条 */
export class AddMcpCallLogs1797000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('mcp_call_logs')) return;
    await queryRunner.createTable(
      new Table({
        name: 'mcp_call_logs',
        columns: [
          {
            name: 'id',
            type: 'int',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'increment',
          },
          { name: 'userId', type: 'int' },
          { name: 'userName', type: 'varchar', length: '120' },
          { name: 'workerId', type: 'int' },
          { name: 'workerName', type: 'varchar', length: '120' },
          { name: 'sessionId', type: 'varchar', length: '80' },
          { name: 'tool', type: 'varchar', length: '40' },
          { name: 'status', type: 'varchar', length: '20' },
          { name: 'durationMs', type: 'int', default: 0 },
          { name: 'messageLength', type: 'int', default: 0 },
          { name: 'contentLength', type: 'int', isNullable: true },
          { name: 'error', type: 'text', isNullable: true },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
        indices: [
          { name: 'IDX_mcp_call_logs_userId', columnNames: ['userId'] },
          { name: 'IDX_mcp_call_logs_workerId', columnNames: ['workerId'] },
          { name: 'IDX_mcp_call_logs_createdAt', columnNames: ['createdAt'] },
        ],
      }),
      true,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('mcp_call_logs'))) return;
    await queryRunner.dropTable('mcp_call_logs');
  }
}

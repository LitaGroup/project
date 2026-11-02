import {
  MigrationInterface,
  QueryRunner,
  TableColumn,
  TableIndex,
} from 'typeorm';

/**
 * 个人 AI AGENT：每个用户绑定唯一的 AI 机器人（workers.personalAgentUserId）。
 * 真人机器人（humanUserId）继续承担「我作为执行者」；个人 AGENT 承担
 * 工作台「我的 AGENT」对话，并通过平台技能代表用户操作任务。
 * 存量用户的个人 AGENT 由 PersonalAgentsService 在登录/打开工作台时补齐。
 */
export class PersonalAgents1794600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('workers', 'personalAgentUserId'))) {
      await queryRunner.addColumn(
        'workers',
        new TableColumn({
          name: 'personalAgentUserId',
          type: 'int',
          isNullable: true,
        }),
      );
    }
    const indexName = 'IDX_workers_personalAgentUserId';
    if (!(await this.hasIndex(queryRunner, 'workers', indexName))) {
      await queryRunner.createIndex(
        'workers',
        new TableIndex({
          name: indexName,
          columnNames: ['personalAgentUserId'],
          isUnique: true,
        }),
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const indexName = 'IDX_workers_personalAgentUserId';
    if (await this.hasIndex(queryRunner, 'workers', indexName)) {
      await queryRunner.dropIndex('workers', indexName);
    }
    if (await queryRunner.hasColumn('workers', 'personalAgentUserId')) {
      await queryRunner.dropColumn('workers', 'personalAgentUserId');
    }
  }

  /** 当前 Schema 中是否存在指定索引 */
  private async hasIndex(
    queryRunner: QueryRunner,
    table: string,
    index: string,
  ): Promise<boolean> {
    const rows = (await queryRunner.query(
      `SELECT 1 FROM pg_indexes WHERE tablename = $1 AND indexname = $2 LIMIT 1`,
      [table, index],
    )) as unknown[];
    return rows.length > 0;
  }
}

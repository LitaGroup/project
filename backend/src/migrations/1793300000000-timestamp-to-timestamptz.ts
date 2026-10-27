import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 时间列统一为 timestamptz（带时区）。
 *
 * 背景：业务库此前同时存在两条时间写入路径——JS 显式 new Date()（按 Node 进程时区 +08，
 * 北京墙钟）与数据库 DEFAULT now()/CURRENT_TIMESTAMP（跟随会话时区，曾为 Etc/UTC）。
 * 无时区 timestamp 列因此混入两种墙钟，同一条记录的展示时间凭空偏差 8 小时。
 * 转 timestamptz 后两条路径均写绝对时间，不再依赖数据库或 Node 进程的时区设置。
 *
 * 存量值在本次搬迁前均为北京墙钟（两种时钟混写已另行搬正），故用显式
 * `AT TIME ZONE 'Asia/Shanghai'` 解释，不依赖迁移会话自身的时区设置。
 * 列清单从 information_schema 动态枚举，避免与实体清单手工对齐。
 */
export class TimestampToTimestamptz1793300000000 implements MigrationInterface {
  name = 'TimestampToTimestamptz1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const columns = (await queryRunner.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = 'timestamp without time zone'
        ORDER BY table_name, ordinal_position`,
    )) as Array<{ table_name: string; column_name: string }>;
    for (const { table_name, column_name } of columns) {
      await queryRunner.query(
        `ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE timestamptz ` +
          `USING "${column_name}" AT TIME ZONE 'Asia/Shanghai'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // knowledge_* 表归知识库且本就是 timestamptz，回滚不触碰
    const columns = (await queryRunner.query(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = 'timestamp with time zone'
          AND table_name NOT LIKE 'knowledge:%' ESCAPE ':'
        ORDER BY table_name, ordinal_position`,
    )) as Array<{ table_name: string; column_name: string }>;
    for (const { table_name, column_name } of columns) {
      await queryRunner.query(
        `ALTER TABLE "${table_name}" ALTER COLUMN "${column_name}" TYPE timestamp ` +
          `USING "${column_name}" AT TIME ZONE 'Asia/Shanghai'`,
      );
    }
  }
}

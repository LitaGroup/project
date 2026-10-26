import 'reflect-metadata';
import { homedir } from 'os';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { createConnection } from 'mysql2/promise';
import { DataSource, type EntityMetadata } from 'typeorm';

// 与后端一致：进程环境变量 > backend/.env > ~/.env。
loadEnv({ path: resolve(homedir(), '.env'), quiet: true });
loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });

const BATCH_SIZE = 100;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数`);
  }
  return value;
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function targetValue(
  metadata: EntityMetadata,
  columnName: string,
  value: unknown,
) {
  const column = metadata.columns.find(
    (item) => item.databaseName === columnName,
  );
  if (value !== null && value !== undefined && column?.type === 'boolean') {
    if (value === 0 || value === '0' || value === false) return false;
    if (value === 1 || value === '1' || value === true) return true;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    (column?.type === 'json' || column?.type === 'jsonb')
  ) {
    // mysql2 会把 JSON 字段解析成 JS 值，而 pg 的原生 JSON 字段需要序列化字符串。
    return JSON.stringify(value);
  }
  return value;
}

async function resetSequences(
  target: DataSource,
  metadata: EntityMetadata,
  sourceAutoIncrement: number,
): Promise<void> {
  for (const column of metadata.columns) {
    if (!column.isGenerated || column.generationStrategy !== 'increment') {
      continue;
    }
    const sequenceRows: Array<{ sequence: string | null }> = await target.query(
      'SELECT pg_get_serial_sequence($1, $2) AS sequence',
      [metadata.tableName, column.databaseName],
    );
    const sequence = sequenceRows[0]?.sequence;
    if (!sequence) continue;
    const maxRows: Array<{ max: number | null }> = await target.query(
      `SELECT MAX(${quote(column.databaseName)})::int AS max FROM ${quote(metadata.tableName)}`,
    );
    const max = maxRows[0]?.max ?? 0;
    // 保留 MySQL 的下一个 ID，连空表和历史主键空洞也不回退，避免复用已删除记录的 ID。
    const lastValue = Math.max(max, sourceAutoIncrement - 1);
    await target.query('SELECT setval($1, $2, $3)', [
      sequence,
      Math.max(lastValue, 1),
      lastValue > 0,
    ]);
  }
}

async function main() {
  const source = await createConnection({
    host: required('MYSQL_HOST'),
    port: numberEnv('MYSQL_PORT', 3306),
    user: required('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD ?? '',
    database: required('MYSQL_DATABASE'),
    dateStrings: true,
    connectTimeout: 10_000,
    ssl:
      process.env.MYSQL_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined,
  });

  const target = new DataSource({
    type: 'postgres',
    host: required('DB_HOST'),
    port: numberEnv('DB_PORT', 5432),
    username: required('DB_USER'),
    password: process.env.DB_PASSWORD || process.env.PROJECT_PG_PASSWORD || '',
    database: required('DB_NAME'),
    ssl:
      process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    entities: [resolve(process.cwd(), 'src/**/*.entity.ts')],
    synchronize: false,
    logging: false,
  });

  try {
    await target.initialize();
    // 以当前实体为唯一结构来源，避免手工维护两套 DDL。
    await target.synchronize();
    const tables = target.entityMetadatas
      .map((metadata) => metadata.tableName)
      .sort();
    const [sourceRows] = await source.query(
      `SELECT TABLE_NAME AS tableName, AUTO_INCREMENT AS autoIncrement
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
      [required('MYSQL_DATABASE')],
    );
    const sourceTableRows = sourceRows as Array<{
      tableName: string;
      autoIncrement: number | string | null;
    }>;
    const sourceTables = new Set(sourceTableRows.map((row) => row.tableName));
    const sourceAutoIncrements = new Map(
      sourceTableRows.map((row) => [
        row.tableName,
        Math.max(1, Number(row.autoIncrement ?? 1)),
      ]),
    );
    const ignoredSourceTables = new Set(
      (process.env.MYSQL_IGNORE_TABLES ?? '')
        .split(',')
        .map((table) => table.trim())
        .filter(Boolean),
    );
    const unknownTables = [...sourceTables].filter(
      (table) => !tables.includes(table) && !ignoredSourceTables.has(table),
    );
    for (const table of ignoredSourceTables) {
      if (sourceTables.has(table)) sourceTables.delete(table);
      console.log(`- ${table}: 按 MYSQL_IGNORE_TABLES 显式跳过源备份表`);
    }
    if (unknownTables.length) {
      throw new Error(
        `源库存在未登记实体的表，已停止以避免漏迁：${unknownTables.join(', ')}`,
      );
    }

    const [taskColumnRows] = await source.query(
      `SELECT COLUMN_NAME AS columnName
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'tasks'`,
      [required('MYSQL_DATABASE')],
    );
    const taskColumns = new Set(
      (taskColumnRows as Array<{ columnName: string }>).map(
        (row) => row.columnName,
      ),
    );
    // 历史库中 tasks 是定时任务，后来才改名 schedules 并让位给任务中心。
    const legacySchedules =
      !sourceTables.has('schedules') &&
      taskColumns.has('cron') &&
      taskColumns.has('checkId');
    const sourceTableFor = (table: string) =>
      table === 'schedules' && legacySchedules ? 'tasks' : table;

    for (const table of tables) {
      const rows: Array<{ count: number }> = await target.query(
        `SELECT COUNT(*)::int AS count FROM ${quote(table)}`,
      );
      if (rows[0].count > 0) {
        throw new Error(
          `目标表 ${table} 已有 ${rows[0].count} 行。请使用空数据库导入，防止覆盖新数据`,
        );
      }
    }

    console.log(`开始迁移 ${tables.length} 张业务表（目标库必须为空）`);
    for (const table of tables) {
      if (table === 'tasks' && legacySchedules) {
        console.log('- tasks: 源表为旧定时任务，已映射到 schedules');
        continue;
      }
      const sourceTable = sourceTableFor(table);
      if (!sourceTables.has(sourceTable)) {
        console.log(`- ${table}: 源表不存在，按新表跳过`);
        continue;
      }
      const metadata = target.entityMetadatas.find(
        (item) => item.tableName === table,
      )!;
      const [rawRows] = await source.query(
        `SELECT * FROM \`${sourceTable.replaceAll('`', '``')}\``,
      );
      const rows = rawRows as Array<Record<string, unknown>>;
      if (table === 'check_runs') {
        for (const row of rows) {
          if (!('scheduleId' in row) && 'taskId' in row) {
            row.scheduleId = row.taskId;
          }
        }
      }
      if (rows.length === 0) {
        await resetSequences(
          target,
          metadata,
          sourceAutoIncrements.get(sourceTable) ?? 1,
        );
        console.log(`- ${table}: 0 行`);
        continue;
      }
      const columns = metadata.columns
        .filter((column) => rows.some((row) => column.databaseName in row))
        .map((column) => column.databaseName);
      if (columns.length === 0) {
        throw new Error(`${table} 没有可映射字段`);
      }

      await target.query('BEGIN');
      try {
        for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
          const batch = rows.slice(offset, offset + BATCH_SIZE);
          const values: unknown[] = [];
          const tuples = batch.map((row) => {
            const placeholders = columns.map((column) => {
              values.push(targetValue(metadata, column, row[column] ?? null));
              return `$${values.length}`;
            });
            return `(${placeholders.join(', ')})`;
          });
          await target.query(
            `INSERT INTO ${quote(table)} (${columns.map(quote).join(', ')})
             VALUES ${tuples.join(', ')}`,
            values,
          );
        }
        await target.query('COMMIT');
      } catch (error) {
        await target.query('ROLLBACK').catch(() => undefined);
        throw error;
      }

      await resetSequences(
        target,
        metadata,
        sourceAutoIncrements.get(sourceTable) ?? 1,
      );
      console.log(`- ${table}: ${rows.length} 行`);
    }

    // 导入后逐表精确核对，避免仅依赖 MySQL information_schema 的估算行数。
    for (const table of tables) {
      if (table === 'tasks' && legacySchedules) continue;
      const sourceTable = sourceTableFor(table);
      if (!sourceTables.has(sourceTable)) continue;
      const [rawSourceCountRows] = await source.query(
        `SELECT COUNT(*) AS count FROM \`${sourceTable.replaceAll('`', '``')}\``,
      );
      const sourceCountRows = rawSourceCountRows as Array<{ count: number }>;
      const targetCountRows: Array<{ count: number }> = await target.query(
        `SELECT COUNT(*)::int AS count FROM ${quote(table)}`,
      );
      const sourceCount = Number(sourceCountRows[0].count);
      const targetCount = Number(targetCountRows[0].count);
      if (sourceCount !== targetCount) {
        throw new Error(
          `${table} 行数不一致：MySQL ${sourceCount} / PostgreSQL ${targetCount}`,
        );
      }
    }
    console.log('迁移完成，所有已迁移表的行数核对一致');
  } finally {
    await source.end().catch(() => undefined);
    if (target.isInitialized) await target.destroy().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(
    `迁移失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});

import { MigrationInterface, QueryRunner } from 'typeorm';

const TABLE = 'task_templates';

/**
 * 任务定义字段合并：把 input / outputSpec 合并进 description，
 * 统一使用「任务定义描述 / 定义任务输入 / 定义任务交付」三个章节，随后删除旧列。
 */
export class MergeTaskTemplateFields1793068800000 implements MigrationInterface {
  name = 'MergeTaskTemplateFields1793068800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;

    const hasInput = await queryRunner.hasColumn(TABLE, 'input');
    const hasOutputSpec = await queryRunner.hasColumn(TABLE, 'outputSpec');
    if (!hasInput && !hasOutputSpec) return;

    const selectColumns = ['id', 'description'];
    if (hasInput) selectColumns.push('"input"');
    if (hasOutputSpec) selectColumns.push('"outputSpec"');
    const rows = (await queryRunner.query(
      `SELECT ${selectColumns.join(', ')} FROM "${TABLE}"`,
    )) as Array<{
      id: number;
      description: string | null;
      input?: string | null;
      outputSpec?: string | null;
    }>;

    for (const row of rows) {
      const description = row.description?.trim() ?? '';
      const alreadyMerged =
        description.includes('## 任务定义描述') &&
        description.includes('## 定义任务输入') &&
        description.includes('## 定义任务交付');
      if (alreadyMerged) continue;

      const input = row.input?.trim() ?? '';
      const outputSpec = row.outputSpec?.trim() ?? '';
      if (!description && !input && !outputSpec) continue;

      const merged = [
        '## 任务定义描述',
        '',
        description,
        '',
        '## 定义任务输入',
        '',
        input,
        '',
        '## 定义任务交付',
        '',
        outputSpec,
      ]
        .join('\n')
        .trim();

      await queryRunner.query(
        `UPDATE "${TABLE}" SET description = $1 WHERE id = $2`,
        [merged, row.id],
      );
    }

    if (hasInput) {
      await queryRunner.query(`ALTER TABLE "${TABLE}" DROP COLUMN "input"`);
    }
    if (hasOutputSpec) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" DROP COLUMN "outputSpec"`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable(TABLE))) return;

    if (!(await queryRunner.hasColumn(TABLE, 'input'))) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN "input" text NULL`,
      );
    }
    if (!(await queryRunner.hasColumn(TABLE, 'outputSpec'))) {
      await queryRunner.query(
        `ALTER TABLE "${TABLE}" ADD COLUMN "outputSpec" text NULL`,
      );
    }
  }
}

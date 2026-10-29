import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 修复存量任务里 AI 生成 Markdown 留下的 URL 冒号转义（`http\://...` → `http://...`）。
 * 冒号在 Markdown 中没有语法含义，`\:` 与 `:` 渲染结果一致，本次是纯显示修复：
 * 任务标题、任务对话（用户消息按纯文本渲染）会把反斜杠原样显示出来。
 */
export class UnescapeTaskUrlColons1794200000000 implements MigrationInterface {
  name = 'UnescapeTaskUrlColons1794200000000';

  private readonly columns = [
    'title',
    'description',
    'input',
    'outputSpec',
    'workPlan',
    'content',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('tasks'))) return;
    for (const column of this.columns) {
      if (!(await queryRunner.hasColumn('tasks', column))) continue;
      await queryRunner.query(
        `UPDATE "tasks" SET "${column}" = replace("${column}", '\\://', '://') WHERE strpos("${column}", '\\://') > 0`,
      );
    }
  }

  public async down(): Promise<void> {
    // 数据修复迁移不可逆（无法区分原始转义）
  }
}

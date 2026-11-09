import { MigrationInterface, QueryRunner } from 'typeorm';

/** 初始任务类型字典（历史迁移内联；任务类型已下线，仅用于回放旧迁移） */
const DEFAULT_TASK_TYPES: Array<{ name: string; description: string }> = [
  { name: '需求分析', description: '梳理需求目标、边界与验收标准' },
  { name: '技术设计', description: '输出技术方案与实现设计' },
  { name: '前端开发', description: '页面与前端功能实现' },
  { name: '后端开发', description: '服务端接口与逻辑实现' },
  { name: '客户端开发', description: '移动客户端功能实现' },
  { name: 'UI', description: '界面与视觉设计' },
  { name: '测试', description: '用例编写与功能验证' },
  { name: '发布', description: '构建发布与上线操作' },
  {
    name: '其它',
    description: '未归类的通用任务（默认类型，不可改名与删除）',
  },
  {
    name: '未知任务',
    description:
      '平台无法匹配任务定义/类型对应机器人时自动归入，由系统未知任务定义（ID=6）接管',
  },
  {
    name: '工单',
    description:
      '工单任务使用的系统类型（历史工单与工单工作流节点任务），不允许改名与删除',
  },
];

/**
 * 任务类型字典：
 * 1. 新建 task_types（名称唯一）；
 * 2. 写入原枚举值（UI设计 → UI）；
 * 3. tasks.type 由 PostgreSQL 枚举改为 varchar(64)，默认「其它」；
 * 4. 清理废弃枚举类型 tasks_type_enum。
 */
export class TaskTypes1793059200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_types (
        id SERIAL PRIMARY KEY,
        name varchar(64) NOT NULL UNIQUE,
        description text NOT NULL DEFAULT '',
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);

    for (const type of DEFAULT_TASK_TYPES) {
      await queryRunner.query(
        `INSERT INTO task_types (name, description) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING`,
        [type.name, type.description],
      );
    }

    // enum → varchar：先删默认值再改类型，避免默认值引用枚举类型
    await queryRunner.query(`
      ALTER TABLE tasks
        ALTER COLUMN type DROP DEFAULT,
        ALTER COLUMN type TYPE varchar(64) USING type::varchar(64),
        ALTER COLUMN type SET DEFAULT '其它',
        ALTER COLUMN type SET NOT NULL
    `);

    // 存量类型改名：原枚举「UI设计」不符合新的名称规则（纯中文 / 纯英文）
    await queryRunner.query(
      `UPDATE tasks SET type = 'UI' WHERE type = 'UI设计'`,
    );

    await queryRunner.query(`DROP TYPE IF EXISTS tasks_type_enum`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 类型已支持自定义，无法安全还原为固定枚举；仅移除任务类型字典表
    await queryRunner.query(`DROP TABLE IF EXISTS task_types`);
  }
}

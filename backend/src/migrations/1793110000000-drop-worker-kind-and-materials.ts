import { MigrationInterface, QueryRunner } from 'typeorm';

/** 下线机器人类型（kind，WorkerKind 智能体/员工）与调度材料（materials）字段。 */
export class DropWorkerKindAndMaterials1793110000000 implements MigrationInterface {
  name = 'DropWorkerKindAndMaterials1793110000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('workers')) {
      if (await queryRunner.hasColumn('workers', 'kind')) {
        await queryRunner.query(`ALTER TABLE "workers" DROP COLUMN "kind"`);
      }
      // 枚举类型不随列删除，需单独清理（TypeORM 默认命名 {table}_{column}_enum）
      await queryRunner.query(`DROP TYPE IF EXISTS "workers_kind_enum"`);
      if (await queryRunner.hasColumn('workers', 'materials')) {
        await queryRunner.query(
          `ALTER TABLE "workers" DROP COLUMN "materials"`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('workers')) {
      if (!(await queryRunner.hasColumn('workers', 'kind'))) {
        await queryRunner.query(
          `CREATE TYPE "workers_kind_enum" AS ENUM ('智能体', '员工')`,
        );
        await queryRunner.query(
          `ALTER TABLE "workers" ADD COLUMN "kind" "workers_kind_enum" NOT NULL DEFAULT '智能体'`,
        );
      }
      if (!(await queryRunner.hasColumn('workers', 'materials'))) {
        await queryRunner.query(
          `ALTER TABLE "workers" ADD COLUMN "materials" text NULL`,
        );
      }
    }
  }
}

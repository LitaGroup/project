import { MigrationInterface, QueryRunner } from 'typeorm';

/** 脚本库运行记录表：脚本无需登记到项目即可直接运行，独立记录输出/结果/产物清单。 */
export class AddScriptLibraryRuns1793400000000 implements MigrationInterface {
  name = 'AddScriptLibraryRuns1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('script_library_runs'))) {
      await queryRunner.query(`
        CREATE TABLE "script_library_runs" (
          "id" SERIAL NOT NULL,
          "scriptPath" character varying(500) NOT NULL,
          "kind" character varying(10) NOT NULL,
          "revision" character varying(40) NULL,
          "status" character varying(20) NOT NULL DEFAULT 'running',
          "total" integer NULL,
          "current" integer NOT NULL DEFAULT 0,
          "success" integer NULL,
          "fail" integer NULL,
          "skip" integer NULL,
          "message" text NULL,
          "durationMs" integer NULL,
          "items" json NULL,
          "logs" json NULL,
          "output" json NULL,
          "files" json NULL,
          "startedAt" timestamptz NOT NULL,
          "finishedAt" timestamptz NULL,
          CONSTRAINT "PK_script_library_runs" PRIMARY KEY ("id")
        )
      `);
      await queryRunner.query(
        `CREATE INDEX "IDX_script_library_runs_script_path" ON "script_library_runs" ("scriptPath")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('script_library_runs')) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_script_library_runs_script_path"`,
      );
      await queryRunner.query(`DROP TABLE "script_library_runs"`);
    }
  }
}

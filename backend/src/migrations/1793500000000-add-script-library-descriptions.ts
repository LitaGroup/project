import { MigrationInterface, QueryRunner } from 'typeorm';

/** 脚本库脚本描述表：脚本描述机器人（#3）分析代码生成的描述与生成状态。 */
export class AddScriptLibraryDescriptions1793500000000 implements MigrationInterface {
  name = 'AddScriptLibraryDescriptions1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasTable('script_library_descriptions'))) {
      await queryRunner.query(`
        CREATE TABLE "script_library_descriptions" (
          "id" SERIAL NOT NULL,
          "scriptPath" character varying(500) NOT NULL,
          "description" text NULL,
          "contentHash" character varying(40) NULL,
          "status" character varying(20) NOT NULL DEFAULT 'pending',
          "error" text NULL,
          "attempts" integer NOT NULL DEFAULT 0,
          "generatedAt" timestamptz NULL,
          "createdAt" timestamptz NOT NULL DEFAULT now(),
          "updatedAt" timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT "PK_script_library_descriptions" PRIMARY KEY ("id")
        )
      `);
      await queryRunner.query(
        `CREATE UNIQUE INDEX "IDX_script_library_descriptions_script_path" ON "script_library_descriptions" ("scriptPath")`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('script_library_descriptions')) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "IDX_script_library_descriptions_script_path"`,
      );
      await queryRunner.query(`DROP TABLE "script_library_descriptions"`);
    }
  }
}

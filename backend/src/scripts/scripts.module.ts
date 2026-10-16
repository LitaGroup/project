import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChecksModule } from '../checks/checks.module';
import { ExportsModule } from '../exports/exports.module';
import { Project } from '../projects/project.entity';
import { TestsModule } from '../tests/tests.module';
import { ScriptsImportController } from './scripts-import.controller';
import { ScriptsImportService } from './scripts-import.service';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Project]),
    ChecksModule,
    TestsModule,
    ExportsModule,
  ],
  controllers: [ScriptsController, ScriptsImportController],
  providers: [ScriptsService, ScriptsImportService],
  exports: [ScriptsService],
})
export class ScriptsModule {}

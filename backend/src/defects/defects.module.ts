import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Project } from '../projects/project.entity';
import { TestsModule } from '../tests/tests.module';
import { DefectChangeRecord } from './defect-change-record.entity';
import { Defect } from './defect.entity';
import {
  DefectsController,
  DefectsMarkdownController,
} from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Defect, DefectChangeRecord, Project]),
    TestsModule,
  ],
  controllers: [DefectsController, DefectsMarkdownController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}

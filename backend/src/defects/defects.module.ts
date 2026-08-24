import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeishuModule } from '../feishu/feishu.module';
import { Project } from '../projects/project.entity';
import { TestsModule } from '../tests/tests.module';
import { Defect } from './defect.entity';
import { DefectsController } from './defects.controller';
import { DefectsService } from './defects.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Defect, Project]),
    FeishuModule,
    TestsModule,
  ],
  controllers: [DefectsController],
  providers: [DefectsService],
  exports: [DefectsService],
})
export class DefectsModule {}

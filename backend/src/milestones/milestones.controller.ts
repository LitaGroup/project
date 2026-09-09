import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { MilestoneAchieved } from '../common/enums';
import {
  CreateMilestoneInput,
  MilestonesService,
  MilestoneView,
  UpdateMilestoneInput,
} from './milestones.service';

class CreateMilestoneDto implements CreateMilestoneInput {
  projectId: number;
  /** 应完成日期（YYYY-MM-DD，北京时间当日 23:59:59 前） */
  date: string;
  /** 内容：该节点要完成的事项 */
  content: string;
  remark?: string;
  deliverer?: string;
  acceptor?: string;
}

class UpdateMilestoneDto implements UpdateMilestoneInput {
  date?: string;
  content?: string;
  remark?: string;
  deliverer?: string;
  acceptor?: string;
  /** 达成标记：no/yes/cancel；yes 须研发验收后标记（自动取北京时间当天为实际达成日期） */
  achieved?: MilestoneAchieved;
}

@Controller('milestones')
export class MilestonesController {
  constructor(private readonly milestonesService: MilestonesService) {}

  /** 节点列表：传 projectId 按项目过滤，不传返回全部（全局列表页用）。按日期升序，附推导状态 */
  @Get()
  findByProject(
    @Query('projectId') projectId?: string,
  ): Promise<MilestoneView[]> {
    return this.milestonesService.findByProject(
      projectId === undefined ? undefined : Number(projectId),
    );
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number): Promise<MilestoneView> {
    return this.milestonesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateMilestoneDto): Promise<MilestoneView> {
    return this.milestonesService.create(dto);
  }

  /** 更新节点（日期/内容/备注/交付人/验收人/达成标记）；achieved=yes 即研发验收（自动记录当天为实际达成日期） */
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMilestoneDto,
  ): Promise<MilestoneView> {
    return this.milestonesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.milestonesService.remove(id);
  }
}

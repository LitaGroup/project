import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { MilestoneAchieved, MilestoneStatus } from '../common/enums';
import { Milestone } from './milestone.entity';

export interface CreateMilestoneInput {
  projectId: number;
  /** 应完成日期（YYYY-MM-DD，北京时间当日 23:59:59 前） */
  date: string;
  /** 内容：该节点要完成的事项 */
  content: string;
  remark?: string;
  /** 交付人（可空） */
  deliverer?: string;
  /** 验收人（可空） */
  acceptor?: string;
}

export interface UpdateMilestoneInput {
  date?: string;
  content?: string;
  remark?: string;
  deliverer?: string;
  acceptor?: string;
  /**
   * 达成标记：no/yes/cancel。yes 须研发验收后标记——自动取北京时间当天为实际达成日期；
   * 改回 no/cancel 时清除实际达成日期。
   */
  achieved?: MilestoneAchieved;
}

/** 节点视图：实体 + 推导状态（status 不落库） */
export type MilestoneView = Milestone & { status: MilestoneStatus };

/** 北京时间当天（YYYY-MM-DD） */
export function beijingToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

/**
 * 推导节点状态：
 * cancel → 取消；
 * yes → 达成日期早于日期1天以上=提前达成 / 等于日期=达成 / 晚于日期=延期；
 * no → 今天（北京）已超过日期=延期，否则=准备中。
 */
export function deriveMilestoneStatus(
  milestone: Pick<Milestone, 'achieved' | 'achievedAt' | 'date'>,
  today: string = beijingToday(),
): MilestoneStatus {
  if (milestone.achieved === MilestoneAchieved.CANCEL) {
    return MilestoneStatus.CANCELLED;
  }
  if (milestone.achieved === MilestoneAchieved.YES) {
    const at = milestone.achievedAt;
    if (at && at < milestone.date) return MilestoneStatus.EARLY;
    if (at === milestone.date) return MilestoneStatus.ACHIEVED;
    return MilestoneStatus.DELAYED;
  }
  return today > milestone.date
    ? MilestoneStatus.DELAYED
    : MilestoneStatus.PREPARING;
}

/**
 * 节点：项目在某个时间点需要完成的事项（日期=北京时间当日 23:59:59 前）。
 * 是否达成需研发验收后标记（achieved=yes 时自动记录当天为实际达成日期）；
 * 状态由 achieved + achievedAt + date 实时推导，不落库。
 */
@Injectable()
export class MilestonesService {
  constructor(
    @InjectRepository(Milestone)
    private readonly milestones: Repository<Milestone>,
  ) {}

  /** 按项目列出节点；不传 projectId 返回全部（全局列表页用）。按日期升序（临近的在前） */
  async findByProject(projectId?: number): Promise<MilestoneView[]> {
    const where: FindOptionsWhere<Milestone> =
      projectId === undefined ? {} : { projectId };
    const items = await this.milestones.find({
      where,
      order: { date: 'ASC', id: 'ASC' },
    });
    return items.map((m) => this.toView(m));
  }

  async findOne(id: number): Promise<MilestoneView> {
    const milestone = await this.milestones.findOne({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone ${id} not found`);
    return this.toView(milestone);
  }

  async create(input: CreateMilestoneInput): Promise<MilestoneView> {
    const date = this.assertDate(input.date);
    const content = this.normalizeText(input.content);
    if (!content) throw new BadRequestException('内容不能为空');
    const saved = await this.milestones.save(
      this.milestones.create({
        projectId: input.projectId,
        date,
        content,
        remark: this.normalizeText(input.remark),
        deliverer: this.normalizeShort(input.deliverer, '交付人'),
        acceptor: this.normalizeShort(input.acceptor, '验收人'),
      }),
    );
    return this.toView(saved);
  }

  /** 更新节点；achieved=yes 自动取北京时间当天为实际达成日期（研发验收动作），no/cancel 清除 */
  async update(
    id: number,
    input: UpdateMilestoneInput,
  ): Promise<MilestoneView> {
    const milestone = await this.milestones.findOne({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone ${id} not found`);
    if (input.date !== undefined) {
      milestone.date = this.assertDate(input.date);
    }
    if (input.content !== undefined) {
      const content = this.normalizeText(input.content);
      if (!content) throw new BadRequestException('内容不能为空');
      milestone.content = content;
    }
    if (input.remark !== undefined) {
      milestone.remark = this.normalizeText(input.remark);
    }
    if (input.deliverer !== undefined) {
      milestone.deliverer = this.normalizeShort(input.deliverer, '交付人');
    }
    if (input.acceptor !== undefined) {
      milestone.acceptor = this.normalizeShort(input.acceptor, '验收人');
    }
    if (input.achieved !== undefined) {
      if (!Object.values(MilestoneAchieved).includes(input.achieved)) {
        throw new BadRequestException(`非法的达成标记：${input.achieved}`);
      }
      if (input.achieved === MilestoneAchieved.YES) {
        // 研发验收：首次标记 yes 时取北京时间当天（已 yes 则不覆盖原达成日期）
        if (milestone.achieved !== MilestoneAchieved.YES) {
          milestone.achievedAt = beijingToday();
        }
      } else {
        milestone.achievedAt = null;
      }
      milestone.achieved = input.achieved;
    }
    return this.toView(await this.milestones.save(milestone));
  }

  async remove(id: number): Promise<void> {
    const milestone = await this.milestones.findOne({ where: { id } });
    if (!milestone) throw new NotFoundException(`Milestone ${id} not found`);
    await this.milestones.remove(milestone);
  }

  /** 删除项目时的应用层级联清理（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.milestones.delete({ projectId });
  }

  private toView(milestone: Milestone): MilestoneView {
    return { ...milestone, status: deriveMilestoneStatus(milestone) };
  }

  /** 日期：YYYY-MM-DD */
  private assertDate(value: string): string {
    const v = value?.trim() ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      throw new BadRequestException('日期须为 YYYY-MM-DD 格式');
    }
    return v;
  }

  /** 长文本：trim，空串 → null */
  private normalizeText(value: string | undefined): string | null {
    const normalized = value?.trim() ?? '';
    return normalized || null;
  }

  /** 短文本（交付人/验收人）：trim，空串 → null，超长拒绝 */
  private normalizeShort(
    value: string | undefined,
    label: string,
  ): string | null {
    const normalized = value?.trim() ?? '';
    if (!normalized) return null;
    if (normalized.length > 100) {
      throw new BadRequestException(`${label}长度不能超过 100 个字符`);
    }
    return normalized;
  }
}

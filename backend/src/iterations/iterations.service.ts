import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import { BacklogStatus, IterationStatus, IterationType } from '../common/enums';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { Backlog } from './backlog.entity';
import { Iteration } from './iteration.entity';
import {
  CreateIterationInput,
  IterationActor,
  IterationProgress,
  IterationSummaryView,
  UpdateIterationInput,
} from './iteration.types';

/** T0 常驻快速通道固定标识与名称 */
export const T0_ITERATION_CODE = 'T0';
export const T0_ITERATION_NAME = 'T0 快速通道';

/** 列表查询上限（迭代数量有限） */
const LIST_LIMIT = 500;

export interface IterationListQuery {
  type?: IterationType;
  status?: IterationStatus;
}

export interface IterationDetailView extends IterationSummaryView {
  backlogs: Backlog[];
}

/** Markdown 表格单元格转义 */
function escapeCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** 今天的北京时间日期串 YYYY-MM-DD */
function todayBeijing(): string {
  return beijingTime(new Date()).slice(0, 10);
}

/** 汇总 backlog 进度 */
export function summarizeBacklogs(
  backlogs: Array<{ status: BacklogStatus }>,
): IterationProgress {
  const statusCounts: Partial<Record<BacklogStatus, number>> = {};
  for (const backlog of backlogs) {
    statusCounts[backlog.status] = (statusCounts[backlog.status] ?? 0) + 1;
  }
  const total = backlogs.length;
  const done = statusCounts[BacklogStatus.COMPLETED] ?? 0;
  return {
    total,
    done,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    statusCounts,
  };
}

/** W1 是否当前迭代（今天在起止区间内）；T0 恒为当前 */
export function isIterationCurrent(iteration: {
  type: IterationType;
  startAt: string | null;
  endAt: string | null;
}): boolean {
  if (iteration.type === IterationType.T0) return true;
  if (!iteration.startAt || !iteration.endAt) return false;
  const today = todayBeijing();
  return iteration.startAt <= today && today <= iteration.endAt;
}

/**
 * 迭代：T0 常驻快速通道 + W1 周迭代。
 * 迭代只是 backlog 的分组容器；需求转入、状态流转、交付任务与飞书群见 BacklogsService。
 */
@Injectable()
export class IterationsService implements OnModuleInit {
  private readonly logger = new Logger(IterationsService.name);

  constructor(
    @InjectRepository(Iteration)
    private readonly iterations: Repository<Iteration>,
    @InjectRepository(Backlog)
    private readonly backlogs: Repository<Backlog>,
  ) {}

  /** 启动时保证 T0 常驻快速通道存在 */
  async onModuleInit(): Promise<void> {
    const existing = await this.iterations.findOne({
      where: { type: IterationType.T0 },
    });
    if (existing) return;
    const codeTaken = await this.iterations.findOne({
      where: { code: T0_ITERATION_CODE },
    });
    if (codeTaken) {
      this.logger.warn(
        `迭代标识 ${T0_ITERATION_CODE} 已被其他迭代占用，未能创建 T0 快速通道`,
      );
      return;
    }
    await this.iterations.save(
      this.iterations.create({
        code: T0_ITERATION_CODE,
        type: IterationType.T0,
        name: T0_ITERATION_NAME,
        startAt: null,
        endAt: null,
        status: IterationStatus.ACTIVE,
      }),
    );
    this.logger.log('T0 快速通道已创建');
  }

  async list(query: IterationListQuery): Promise<IterationSummaryView[]> {
    const where: FindOptionsWhere<Iteration> = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    const rows = await this.iterations.find({
      where,
      order: { id: 'DESC' },
      take: LIST_LIMIT,
    });
    if (rows.length === 0) return [];
    const allBacklogs = await this.backlogs.find({
      where: rows.map((row) => ({ iterationId: row.id })),
      select: { id: true, iterationId: true, status: true },
    });
    const byIteration = new Map<number, Backlog[]>();
    for (const backlog of allBacklogs) {
      const list = byIteration.get(backlog.iterationId) ?? [];
      list.push(backlog);
      byIteration.set(backlog.iterationId, list);
    }
    const views = rows.map((row) =>
      this.toSummary(row, byIteration.get(row.id) ?? []),
    );
    // T0 常驻置顶；W1 按开始日期倒序（新迭代在前），无日期按 id 倒序
    return views.sort((a, b) => {
      if (a.type === IterationType.T0) return -1;
      if (b.type === IterationType.T0) return 1;
      if (a.startAt && b.startAt) return b.startAt.localeCompare(a.startAt);
      if (a.startAt) return -1;
      if (b.startAt) return 1;
      return b.id - a.id;
    });
  }

  async findOne(id: number): Promise<IterationDetailView> {
    const iteration = await this.iterations.findOne({ where: { id } });
    if (!iteration) throw new NotFoundException(`Iteration ${id} not found`);
    const backlogs = await this.backlogs.find({
      where: { iterationId: id },
      order: { id: 'DESC' },
    });
    return { ...this.toSummary(iteration, backlogs), backlogs };
  }

  async mustFind(id: number): Promise<Iteration> {
    const iteration = await this.iterations.findOne({ where: { id } });
    if (!iteration) throw new NotFoundException(`Iteration ${id} not found`);
    return iteration;
  }

  /** 创建 W1 周迭代（仅管理员） */
  async create(
    input: CreateIterationInput,
    actor: IterationActor,
  ): Promise<Iteration> {
    this.assertAdmin(actor, '仅管理员可创建迭代');
    const code = this.normalizeCode(input.code);
    if (code === T0_ITERATION_CODE) {
      throw new BadRequestException('T0 为平台常驻快速通道，不可重复创建');
    }
    const name = this.normalizeName(input.name);
    const startAt = this.normalizeDate(input.startAt, '开始日期');
    const endAt = this.normalizeDate(input.endAt, '结束日期');
    if (!startAt || !endAt) {
      throw new BadRequestException('W1 迭代须填写开始日期与结束日期');
    }
    this.assertDateOrder(startAt, endAt);
    const exists = await this.iterations.findOne({ where: { code } });
    if (exists) throw new BadRequestException(`迭代标识 ${code} 已存在`);
    return this.iterations.save(
      this.iterations.create({
        code,
        type: IterationType.W1,
        name,
        startAt,
        endAt,
        status: IterationStatus.ACTIVE,
      }),
    );
  }

  /** 更新迭代（仅管理员）：名称 / 起止日期 / 结束或重开 */
  async update(
    id: number,
    input: UpdateIterationInput,
    actor: IterationActor,
  ): Promise<Iteration> {
    this.assertAdmin(actor, '仅管理员可修改迭代');
    const iteration = await this.mustFind(id);
    if (input.name !== undefined)
      iteration.name = this.normalizeName(input.name);
    if (input.startAt !== undefined) {
      iteration.startAt = this.normalizeDate(input.startAt, '开始日期');
    }
    if (input.endAt !== undefined) {
      iteration.endAt = this.normalizeDate(input.endAt, '结束日期');
    }
    if (iteration.type === IterationType.W1) {
      if (!iteration.startAt || !iteration.endAt) {
        throw new BadRequestException('W1 迭代须填写开始日期与结束日期');
      }
      this.assertDateOrder(iteration.startAt, iteration.endAt);
    }
    if (input.status !== undefined) {
      if (!Object.values(IterationStatus).includes(input.status)) {
        throw new BadRequestException('迭代状态仅允许：进行中/已结束');
      }
      if (
        iteration.type === IterationType.T0 &&
        input.status !== IterationStatus.ACTIVE
      ) {
        throw new ForbiddenException('T0 快速通道常驻，不可结束');
      }
      iteration.status = input.status;
    }
    return this.iterations.save(iteration);
  }

  async listMarkdown(query: IterationListQuery): Promise<string> {
    const rows = await this.list(query);
    const head = mdFrontmatter({
      title: '迭代列表',
      description: `共 ${rows.length} 个迭代`,
    });
    const lines: string[] = [
      '# 迭代',
      '',
      `共 ${rows.length} 个迭代。详情：GET /api/iterations/{id}.md；迭代项详情：GET /api/backlogs/{id}.md。`,
      '',
    ];
    if (rows.length === 0) {
      lines.push('（暂无迭代）');
    } else {
      lines.push(
        '| ID | 标识 | 类型 | 名称 | 起止 | 状态 | 迭代项 | 完成 | 详情 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const row of rows) {
        lines.push(
          `| ${row.id} | ${escapeCell(row.code)} | ${row.type} | ${escapeCell(
            row.name,
          )} | ${this.dateRangeText(row.startAt, row.endAt)} | ${row.status} | ${
            row.total
          } | ${row.done} | /api/iterations/${row.id}.md |`,
        );
      }
    }
    return `${head}${lines.join('\n')}\n`;
  }

  async findOneMarkdown(id: number): Promise<string> {
    const detail = await this.findOne(id);
    const head = mdFrontmatter({
      update: detail.updatedAt,
      title: detail.name,
      code: detail.code,
      type: detail.type,
      status: detail.status,
      startAt: detail.startAt ?? undefined,
      endAt: detail.endAt ?? undefined,
    });
    const meta = [
      `- 迭代 ID：${detail.id}`,
      `- 唯一标识：${detail.code}`,
      `- 类型：${detail.type}`,
      `- 状态：${detail.status}`,
      `- 起止：${this.dateRangeText(detail.startAt, detail.endAt)}`,
      `- 迭代项：${detail.total} 个，已完成 ${detail.done} 个（${detail.percent}%）`,
      `- 平台链接：/iterations/${detail.id}`,
    ];
    const sections = ['# 迭代', '', ...meta, '', '## 迭代项', ''];
    if (detail.backlogs.length === 0) {
      sections.push('（暂无迭代项）');
    } else {
      sections.push(
        '| ID | 编号 | 原始需求 | 状态 | 负责人 | 交付任务 | 详情 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      );
      for (const backlog of detail.backlogs) {
        sections.push(
          `| ${backlog.id} | ${backlog.code} | #${backlog.projectId} ${escapeCell(
            backlog.title,
          )} | ${backlog.status} | ${escapeCell(backlog.ownerName ?? '-')} | ${
            backlog.taskId ? `#${backlog.taskId}` : '-'
          } | /api/backlogs/${backlog.id}.md |`,
        );
      }
    }
    return `${head}${sections.join('\n')}\n`;
  }

  private toSummary(
    iteration: Iteration,
    backlogs: Pick<Backlog, 'id' | 'status'>[],
  ): IterationSummaryView {
    const progress = summarizeBacklogs(backlogs);
    return {
      id: iteration.id,
      code: iteration.code,
      type: iteration.type,
      name: iteration.name,
      startAt: iteration.startAt,
      endAt: iteration.endAt,
      status: iteration.status,
      current: isIterationCurrent(iteration),
      createdAt: iteration.createdAt,
      updatedAt: iteration.updatedAt,
      ...progress,
    };
  }

  private dateRangeText(startAt: string | null, endAt: string | null): string {
    if (!startAt && !endAt) return '长期';
    return `${startAt ?? '?'} ~ ${endAt ?? '?'}`;
  }

  private assertAdmin(actor: IterationActor, message: string): void {
    if (!actor.isAdmin) throw new ForbiddenException(message);
  }

  private normalizeCode(code: string): string {
    const trimmed = (code ?? '').trim();
    if (!trimmed) throw new BadRequestException('迭代标识不能为空');
    if (trimmed.length > 50)
      throw new BadRequestException('迭代标识最长 50 字');
    if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
      throw new BadRequestException('迭代标识仅允许字母、数字、下划线和短横线');
    }
    return trimmed;
  }

  private normalizeName(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new BadRequestException('迭代名称不能为空');
    if (trimmed.length > 200)
      throw new BadRequestException('迭代名称最长 200 字');
    return trimmed;
  }

  private normalizeDate(
    value: string | null | undefined,
    label: string,
  ): string | null {
    if (value === undefined || value === null || value === '') return null;
    const trimmed = String(value).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException(`${label}格式须为 YYYY-MM-DD`);
    }
    return trimmed;
  }

  private assertDateOrder(startAt: string, endAt: string): void {
    if (startAt > endAt) {
      throw new BadRequestException('开始日期不能晚于结束日期');
    }
  }
}

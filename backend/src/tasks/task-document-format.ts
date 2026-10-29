import { beijingTime } from '../common/frontmatter';
import type { Task } from './task.entity';
import type { TaskDeliveryReport } from './task-delivery-report';

export interface TaskDocumentStats {
  confirmations: number;
  supplements: number;
  durationLabel: string;
}

export interface TaskDocumentRenderInput {
  kind: 'handoff' | 'review';
  task: Task;
  path: string;
  generatedAt: Date;
  /** 执行机器人名称（历史任务可能未记录） */
  workerName: string | null;
  workerId: number | null;
  /** 执行机器人负责人 */
  workerOwnerName: string | null;
  /** 任务需求方（人或机器人） */
  requesterName: string | null;
  /** 任务定义名称与说明 */
  definitionName: string | null;
  definitionDescription: string | null;
  /** 平台采集的最终交付原文 */
  result: string | null;
  /** 机器人提交/总结的交付与复盘内容 */
  report: TaskDeliveryReport;
  /** REVIEW 专属 */
  acceptedAt?: Date | null;
  acceptedBy?: string | null;
  stats?: TaskDocumentStats;
}

function markdownText(
  value: string | null | undefined,
  empty = '（暂无）',
): string {
  return value?.trim() || empty;
}

function escapeCell(
  value: string | null | undefined,
  empty = '未记录',
): string {
  const text = value?.trim() || empty;
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/**
 * HANDOFF / REVIEW 共用同一信息架构：
 * 0 任务与责任 → 1 需求说明 → 2 交付内容 → 3 问题与解决
 * → 4 弯路与经验 → 5 遗留建议 → 6 其它；REVIEW 末尾附任务统计。
 */
export function renderTaskDocument(input: TaskDocumentRenderInput): string {
  const { task, report } = input;
  const title =
    input.kind === 'handoff'
      ? `${task.code} ${task.title} · 任务交付文档`
      : `${task.code} ${task.title} · 任务复盘`;
  const originalInput = task.input?.trim() || task.description?.trim() || '';
  const originalNote =
    !task.input?.trim() && task.description?.trim()
      ? '> 原始输入未单独保存，以下取创建任务时的描述。\n'
      : '';
  const workerLabel = input.workerName
    ? `${input.workerName}${input.workerId ? `（${input.workerId}）` : ''}`
    : '未记录';
  const responsibilityRows =
    input.kind === 'handoff'
      ? [
          `| 申请验收时间 | ${beijingTime(input.generatedAt)} |`,
          `| 累计验收不通过 | ${task.acceptRejectCount ?? 0} 次 |`,
        ]
      : [
          `| 验收时间 | ${
            input.acceptedAt ? beijingTime(input.acceptedAt) : '未记录'
          } |`,
          `| 验收人 | ${escapeCell(input.acceptedBy)} |`,
          `| 累计验收不通过 | ${task.acceptRejectCount ?? 0} 次 |`,
        ];

  const lines = [
    `# ${title}`,
    '',
    input.kind === 'handoff'
      ? `> 文档类型：任务交付 ｜ 申请验收时间：${beijingTime(
          input.generatedAt,
        )} ｜ 执行机器人：${workerLabel} ｜ 文档路径：\`${input.path}\``
      : `> 文档类型：任务复盘 ｜ 生成时间：${beijingTime(
          input.generatedAt,
        )} ｜ 归档路径：\`${input.path}\``,
    '',
    '## 0、任务与责任',
    '',
    '| 字段 | 内容 |',
    '| --- | --- |',
    `| 任务编号 | ${escapeCell(task.code)} |`,
    `| 任务标题 | ${escapeCell(task.title)} |`,
    `| 任务类型 | ${escapeCell(task.type)} |`,
    `| 任务定义 | ${escapeCell(input.definitionName)} |`,
    `| 需求方 | ${escapeCell(input.requesterName)} |`,
    `| 执行机器人 | ${escapeCell(workerLabel)} |`,
    `| 机器人负责人 | ${escapeCell(input.workerOwnerName)} |`,
    `| 创建时间 | ${beijingTime(task.createdAt)} |`,
    ...responsibilityRows,
    '',
    '### 任务定义说明',
    '',
    markdownText(
      input.definitionDescription,
      '（未配置任务定义说明，或该任务未指定任务定义）',
    ),
    '',
    '### 任务内容',
    '',
    markdownText(task.description, '（未记录任务内容）'),
    '',
    '### 输出要求',
    '',
    markdownText(task.outputSpec, '（未记录输出要求）'),
    '',
    '### 工作计划',
    '',
    markdownText(task.workPlan, '（未记录工作计划）'),
    '',
    '## 1、需求说明',
    '',
    '### 原始需求',
    '',
    originalNote + markdownText(originalInput, '（未记录原始需求）'),
    '',
    '### 分析后的需求',
    '',
    markdownText(task.content, '（未记录独立分析后的需求）'),
    '',
    '## 2、交付内容',
    '',
    '### 最终交付原文（平台采集）',
    '',
    markdownText(input.result, '（无最终交付记录）'),
    '',
    '### 执行机器人交付说明',
    '',
    markdownText(report.delivery, '（执行机器人未提交交付说明，记录中未体现）'),
    '',
    '## 3、实现问题与解决',
    '',
    markdownText(report.problems, '（未记录实现问题与解决过程）'),
    '',
    '## 4、弯路与经验复盘',
    '',
    '### 走过的弯路',
    '',
    markdownText(report.detours, '（未记录明确弯路）'),
    '',
    '### 经验总结',
    '',
    markdownText(report.lessons, '（未记录经验总结）'),
    '',
    '## 5、遗留建议与后续待办',
    '',
    markdownText(report.followUps, '（无遗留建议或后续待办）'),
    '',
    '## 6、其它需要保留的信息',
    '',
    markdownText(report.other, '（无其它需要保留的信息）'),
    '',
  ];

  if (input.kind === 'review' && input.stats) {
    lines.push(
      '## 附录：任务统计',
      '',
      '| 指标 | 数值 |',
      '| --- | --- |',
      `| 用户确认次数 | ${input.stats.confirmations} 次 |`,
      `| 补充信息次数 | ${input.stats.supplements} 次 |`,
      `| 累计验收不通过次数 | ${task.acceptRejectCount ?? 0} 次 |`,
      `| 持续时长 | ${input.stats.durationLabel} |`,
      `| 开始时间 | ${beijingTime(task.createdAt)} |`,
      `| 验收时间 | ${
        input.acceptedAt ? beijingTime(input.acceptedAt) : '未记录'
      } |`,
      '',
    );
  }

  return lines.join('\n');
}

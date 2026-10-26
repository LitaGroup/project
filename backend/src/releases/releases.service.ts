import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { In, Repository } from 'typeorm';
import { ProjectStatus, ReleaseStatus } from '../common/enums';
import { splitMemberNames } from '../common/names';
import { beijingTime, mdFrontmatter } from '../common/frontmatter';
import { FeishuService } from '../feishu/feishu.service';
import { Project } from '../projects/project.entity';
import { User } from '../auth/user.entity';
import { ProjectRelease, ReleaseBranch } from './project-release.entity';

/** 提测通知群「H5 Release | 提测上线」的群机器人 webhook（固定） */
const RELEASE_WEBHOOK =
  'https://open.feishu.cn/open-apis/bot/v2/hook/819b2008-2cb9-4a2d-a44a-92d01cea83d9';

/** 卡片内提测内容截断长度（lark_md 卡片过长会被飞书折叠/截断） */
const CONTENT_CARD_MAX = 800;

/** 提测状态可选值（待冒烟 / 已通过 / 未通过） */
export const RELEASE_STATUS_VALUES: string[] = Object.values(ReleaseStatus);

/** 读库状态归一：历史行或异常值为空时按「待冒烟」处理 */
function releaseStatusOf(status?: string | null): ReleaseStatus {
  return RELEASE_STATUS_VALUES.includes(status ?? '')
    ? (status as ReleaseStatus)
    : ReleaseStatus.PENDING;
}

export interface SubmitReleaseInput {
  content?: string;
  urls?: string[];
  branches?: { repo: string; branch: string }[];
  testers: string[];
}

@Injectable()
export class ReleasesService {
  private readonly logger = new Logger(ReleasesService.name);
  private readonly appUrl: string;

  constructor(
    @InjectRepository(ProjectRelease)
    private readonly releases: Repository<ProjectRelease>,
    @InjectRepository(Project)
    private readonly projects: Repository<Project>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    private readonly feishu: FeishuService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:5273';
  }

  /**
   * 提测：创建提测记录并把项目状态流转为「测试中」。
   * 测试人员至少 1 人且均须存在于用户系统（users 表，飞书登录落库），否则 400。
   * 通知（提测群 + 项目人员私聊）异步发送，失败仅告警不阻断提测。
   */
  async submit(
    projectId: number,
    input: SubmitReleaseInput,
    operator?: string | null,
  ): Promise<ProjectRelease> {
    const project = await this.projects.findOne({ where: { id: projectId } });
    if (!project) throw new NotFoundException(`Project ${projectId} not found`);

    const testers = splitMemberNames((input.testers ?? []).join('、'));
    if (testers.length === 0) {
      throw new BadRequestException('测试人员至少填写 1 人');
    }
    await this.assertNamesInUserSystem(testers, '测试人员');

    const content = input.content?.trim() || null;
    const urls = this.normalizeUrls(input.urls);
    const branches = this.normalizeBranches(input.branches);

    const release = await this.releases.save(
      this.releases.create({
        projectId: project.id,
        content,
        urls: urls.length > 0 ? urls : null,
        branches: branches.length > 0 ? branches : null,
        testers,
        operator: operator?.trim() || null,
        // 新提测一律「待冒烟」，由测试同学判定通过与否
        status: ReleaseStatus.PENDING,
        verifier: null,
        verifiedAt: null,
      }),
    );

    // 状态流转为「测试中」（重复提测保持该状态，仅追加记录）
    if (project.status !== ProjectStatus.IN_TEST) {
      project.status = ProjectStatus.IN_TEST;
      await this.projects.save(project);
    }

    // 通知不阻断提测（群机器人 / 私聊失败仅告警）
    void this.notify(release, project);
    return release;
  }

  /** 提测记录列表（倒序）；不传 projectId 返回全部 */
  findByProject(projectId?: number): Promise<ProjectRelease[]> {
    return this.releases.find({
      where: projectId === undefined ? {} : { projectId },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
  }

  /**
   * 测试同学判定提测结果：待冒烟 → 已通过 / 未通过（也可改回待冒烟重新冒烟）。
   * 判定为已通过/未通过时记录判定人与判定时间；改回待冒烟时清空。
   * 状态未变化幂等返回（不刷新判定时间）。
   */
  async updateStatus(
    id: number,
    status: ReleaseStatus,
    operator?: string | null,
  ): Promise<ProjectRelease> {
    if (!RELEASE_STATUS_VALUES.includes(status)) {
      throw new BadRequestException(
        `提测状态非法：${status ?? '（空）'}，可选值：${RELEASE_STATUS_VALUES.join('、')}`,
      );
    }
    const release = await this.releases.findOne({ where: { id } });
    if (!release) throw new NotFoundException(`Release ${id} not found`);

    if (releaseStatusOf(release.status) === status) return release;

    const now = new Date();
    release.status = status;
    if (status === ReleaseStatus.PENDING) {
      release.verifier = null;
      release.verifiedAt = null;
    } else {
      release.verifier = operator?.trim() || null;
      release.verifiedAt = now;
    }
    return this.releases.save(release);
  }

  /** AI 用：判定提测结果并返回 Markdown 结果 */
  async updateStatusMarkdown(
    id: number,
    status: ReleaseStatus,
    operator?: string | null,
  ): Promise<string> {
    const release = await this.updateStatus(id, status, operator);
    const project = await this.projects.findOne({
      where: { id: release.projectId },
    });
    return [
      mdFrontmatter({
        update: release.verifiedAt ?? release.createdAt,
        title: `提测记录 #${release.id} - ${releaseStatusOf(release.status)}`,
      }),
      '# 提测状态已更新',
      '',
      `- 项目：${project?.name ?? `#${release.projectId}`}（#${release.projectId}）`,
      `- 提测记录：id ${release.id}（提测时间 ${beijingTime(release.createdAt)}）`,
      `- 提测人：${release.operator ?? '—'}`,
      `- 测试人员：${release.testers.join('、')}`,
      `- 当前状态：**${releaseStatusOf(release.status)}**`,
      release.verifier ? `- 判定人：${release.verifier}` : null,
      release.verifiedAt
        ? `- 判定时间：${beijingTime(release.verifiedAt)}`
        : null,
      `- 提测记录清单：GET /api/releases.md?projectId=${release.projectId}`,
      '',
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  }

  /** AI 用：提测并返回 Markdown 结果 */
  async submitMarkdown(
    projectId: number,
    input: SubmitReleaseInput,
    operator?: string | null,
  ): Promise<string> {
    const release = await this.submit(projectId, input, operator);
    const project = await this.projects.findOne({
      where: { id: release.projectId },
    });
    return [
      mdFrontmatter({
        update: release.createdAt,
        title: `项目提测 - ${project?.name ?? release.projectId}`,
      }),
      '# 项目已提测',
      '',
      `- 项目：${project?.name ?? `#${release.projectId}`}（#${release.projectId}），状态已流转为「${ProjectStatus.IN_TEST}」`,
      `- 提测人：${release.operator ?? '—'}`,
      `- 提测时间：${beijingTime(release.createdAt)}`,
      `- 测试人员：${release.testers.join('、')}`,
      `- 访问地址：${release.urls?.length ? release.urls.join('、') : '—'}`,
      `- 代码分支：${
        release.branches?.length
          ? release.branches
              .map((b) => `\`${b.repo}\` @ \`${b.branch}\``)
              .join('、')
          : '—'
      }`,
      `- 提测内容：${release.content ? '已记录（见项目详情）' : '—'}`,
      `- 提测状态：**${releaseStatusOf(release.status)}**（由测试同学判定「已通过 / 未通过」）`,
      `- 已通知：提测群「H5 Release | 提测上线」+ 项目人员私聊（发送失败仅告警，不影响提测）`,
      `- 阅读地址：GET /api/projects/${release.projectId}.md`,
      `- 提测记录：GET /api/releases.md?projectId=${release.projectId}`,
      '',
    ].join('\n');
  }

  /** 提测记录清单 Markdown（GET /api/releases.md?projectId=） */
  async listMarkdown(projectId?: number): Promise<string> {
    const items = await this.findByProject(projectId);
    const title =
      projectId === undefined ? '提测记录' : `提测记录（项目 #${projectId}）`;
    const lines = items.map((r) => {
      const status = releaseStatusOf(r.status);
      const head = `- **${beijingTime(r.createdAt)}**（id：${r.id}）提测人 ${r.operator ?? '—'} — 状态：**${status}**`;
      const detail = [
        `测试人员：${r.testers.join('、')}`,
        r.verifier ? `判定人：${r.verifier}` : null,
        r.verifiedAt ? `判定时间：${beijingTime(r.verifiedAt)}` : null,
        r.urls?.length ? `访问地址：${r.urls.join('、')}` : null,
        r.branches?.length
          ? `代码分支：${r.branches.map((b) => `\`${b.repo}\` @ \`${b.branch}\``).join('、')}`
          : null,
        r.content ? `提测内容：${oneLine(r.content, 120)}` : null,
      ].filter(Boolean);
      return [head, ...detail.map((d) => `  - ${d}`)].join('\n');
    });
    return [
      mdFrontmatter({ title }),
      `# ${title}`,
      '',
      `共 ${items.length} 条（按提测时间倒序）。提测：\`POST /api/projects/{projectId}/release.md\`，body \`{"testers": ["张三"], "content": "提测内容 Markdown", "urls": ["https://..."], "branches": [{"repo": "LitaGroup/xxx", "branch": "test"}]}\`（仅 testers 必填且须为用户系统内用户）`,
      `判定提测结果（由测试同学操作）：\`POST /api/releases/{id}/status.md\`，body \`{"status": "已通过" | "未通过" | "待冒烟"}\`——新提测默认「待冒烟」，改回「待冒烟」会清空判定人/判定时间以便重新冒烟`,
      '',
      ...(lines.length > 0 ? lines : ['（暂无提测记录）']),
      '',
    ].join('\n');
  }

  /**
   * 校验姓名均存在于用户系统（users 表，飞书登录落库），不存在则 400 并列出无效姓名。
   * 供提测测试人员与项目人员（resources）配置共用——项目中不允许配置用户系统之外的人。
   */
  async assertNamesInUserSystem(names: string[], label: string): Promise<void> {
    const found = await this.users.find({
      where: { name: In(names) },
      select: { name: true },
    });
    const known = new Set(found.map((u) => u.name));
    const missing = names.filter((n) => !known.has(n));
    if (missing.length > 0) {
      throw new BadRequestException(
        `${label}不存在于用户系统中（须为飞书登录过的用户）：${missing.join('、')}`,
      );
    }
  }

  /** 删除项目时应用层级联删提测记录（测试库无物理外键） */
  async removeByProject(projectId: number): Promise<void> {
    await this.releases.delete({ projectId });
  }

  // ---- 内部 ----

  /** 访问地址：trim 去空（格式宽松，允许内网地址） */
  private normalizeUrls(urls?: string[]): string[] {
    if (!Array.isArray(urls)) return [];
    return urls
      .map((u) => (typeof u === 'string' ? u.trim() : ''))
      .filter(Boolean);
  }

  /** 代码分支：仓库与分支均非空才保留 */
  private normalizeBranches(
    branches?: { repo: string; branch: string }[],
  ): ReleaseBranch[] {
    if (!Array.isArray(branches)) return [];
    return branches
      .map((b) => ({
        repo: (b?.repo ?? '').trim(),
        branch: (b?.branch ?? '').trim(),
      }))
      .filter((b) => b.repo && b.branch);
  }

  /**
   * 提测通知：提测群机器人 webhook + 项目人员（resources 全部人员 + 测试人员，去重）
   * 机器人私聊卡片。人员按姓名在 users 表查 openId，查不到的跳过并告警。
   */
  private async notify(
    release: ProjectRelease,
    project: Project,
  ): Promise<void> {
    const card = this.buildCard(release, project);
    await Promise.all([
      this.sendGroupWebhook(release.projectId, card),
      this.notifyMembers(release, project, card),
    ]);
  }

  private buildCard(
    release: ProjectRelease,
    project: Project,
  ): Record<string, unknown> {
    const lines = [
      `**项目**：${project.name}（#${project.id}）`,
      `**提测人**：${release.operator ?? '—'}`,
      `**提测时间**：${beijingTime(release.createdAt)}`,
      `**测试人员**：${release.testers.join('、')}`,
    ];
    if (release.branches?.length) {
      lines.push(
        `**代码分支**：${release.branches.map((b) => `\`${b.repo}\` @ \`${b.branch}\``).join('\n')}`,
      );
    }
    if (release.urls?.length) {
      // lark_md 对裸 URL 自动加链（尖括号 <url> 语法会导致卡片解析失败 code 230099）
      lines.push(`**访问地址**：${release.urls.join('\n')}`);
    }
    if (release.content) {
      lines.push(`**提测内容**：${oneLine(release.content, CONTENT_CARD_MAX)}`);
    }
    lines.push(
      `**详情**：[查看项目](${this.appUrl.replace(/\/$/, '')}/projects/${project.id})`,
    );
    // 卡片体：机器人 API（sendUserCard）直接发送该对象；群机器人 webhook 发送时外层再包 msg_type 信封
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: 'plain_text', content: `[提测] ${project.name}` },
        template: 'blue',
      },
      elements: [
        { tag: 'div', text: { tag: 'lark_md', content: lines.join('\n') } },
      ],
    };
  }

  /** 群机器人 webhook（免签，需 msg_type 信封），业务失败也可能 HTTP 200，需看响应体 code */
  private async sendGroupWebhook(
    projectId: number,
    card: Record<string, unknown>,
  ): Promise<void> {
    try {
      const res = await fetch(RELEASE_WEBHOOK, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_type: 'interactive', card }),
      });
      const body = (await res.json().catch(() => null)) as {
        code?: number;
        StatusCode?: number;
        msg?: string;
        StatusMessage?: string;
      } | null;
      const code = body?.code ?? body?.StatusCode ?? (res.ok ? 0 : -1);
      if (!res.ok || code !== 0) {
        this.logger.warn(
          `提测群推送失败（HTTP ${res.status}, code ${code}: ${body?.msg ?? body?.StatusMessage ?? '-'}）: project=${projectId}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `提测群推送异常: ${(e as Error).message}（project=${projectId}）`,
      );
    }
  }

  /** 项目人员（resources 前端/后端/测试/客户端）+ 测试人员 去重后逐个私聊卡片 */
  private async notifyMembers(
    release: ProjectRelease,
    project: Project,
    card: Record<string, unknown>,
  ): Promise<void> {
    const names = new Set(release.testers);
    for (const key of ['frontend', 'backend', 'qa', 'client'] as const) {
      for (const name of splitMemberNames(project.resources?.[key])) {
        names.add(name);
      }
    }
    if (names.size === 0) return;
    let members: User[];
    try {
      members = await this.users.find({ where: { name: In([...names]) } });
    } catch (e) {
      this.logger.warn(`提测通知查询用户失败: ${(e as Error).message}`);
      return;
    }
    const resolved = new Set(members.map((m) => m.name));
    for (const name of names) {
      if (!resolved.has(name)) {
        this.logger.warn(
          `提测私聊跳过「${name}」：用户系统中不存在（project=${release.projectId}）`,
        );
      }
    }
    await Promise.allSettled(
      members
        .filter((m) => m.feishuOpenId)
        .map((m) =>
          this.feishu.sendUserCard(m.feishuOpenId, card).catch((e: Error) => {
            this.logger.warn(
              `提测私聊发送失败「${m.name}」: ${e.message}（需应用具备 im:message:send_as_bot 且用户在可用范围内）`,
            );
          }),
        ),
    );
  }
}

/** 单行摘要：折叠换行 + 截断 */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s*\n\s*/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

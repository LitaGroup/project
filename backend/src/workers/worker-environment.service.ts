import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkerRuntime } from '../common/enums';
import { Executor } from '../executors/executor.entity';
import { OpencodeClient } from '../executors/opencode-client';
import { runOpencodePrompt } from '../executors/opencode-run';
import { Worker } from './worker.entity';
import { WorkersService } from './workers.service';
import {
  ManagedStandardFiles,
  WorkerStandardCatalogService,
} from './worker-standard-catalog.service';

/** 初始化任务超时（含技能下载与规范文档同步） */
const INITIALIZE_TIMEOUT_MS = 10 * 60_000;

/**
 * 机器人工作环境初始化：把数据库中的 AGENTS.md、技能引用与规范引用应用到工位。
 * 工位目录结构：
 * - AGENTS.md
 * - .opencode/skills/
 * - .opencode/docs/（选中规范的目录镜像，另有 .standards-manifest.json 受管清单）
 */
@Injectable()
export class WorkerEnvironmentService {
  private readonly logger = new Logger(WorkerEnvironmentService.name);

  constructor(
    @InjectRepository(Worker)
    private readonly workers: Repository<Worker>,
    @InjectRepository(Executor)
    private readonly executors: Repository<Executor>,
    private readonly workersService: WorkersService,
    private readonly standardCatalog: WorkerStandardCatalogService,
  ) {}

  /** 初始化/同步指定机器人的工作环境；成功返回 DONE 校验后的工位路径 */
  async initialize(
    id: number,
  ): Promise<{ status: 'success'; workdir: string }> {
    const worker = await this.workers.findOne({ where: { id } });
    if (!worker) throw new BadRequestException('机器人不存在');
    if (worker.runtime !== WorkerRuntime.OPENCODE) {
      throw new BadRequestException('仅支持 opencode 机器人初始化');
    }
    if (
      !worker.executorId ||
      !worker.providerId?.trim() ||
      !worker.modelId?.trim()
    ) {
      throw new BadRequestException(
        '初始化工作环境前，请先配置执行器、供应商与模型',
      );
    }
    const workdir = this.workersService.workdirOf(worker.id);
    if (!workdir) {
      throw new BadRequestException('未配置 WORKER_BASE_DIR，无法确定工位目录');
    }
    const executor = await this.executors.findOne({
      where: { id: worker.executorId },
    });
    if (!executor || !executor.online) {
      throw new BadRequestException(
        `执行器 #${worker.executorId} 离线或不存在，无法初始化工作环境`,
      );
    }

    const client = new OpencodeClient(executor);
    // 幂等建立工位骨架，初始化会话内仍会按需补齐
    await client.shell(
      `mkdir -p '${workdir}' '${workdir}/.opencode/skills' '${workdir}/.opencode/docs'`,
    );
    const text = await runOpencodePrompt(client, {
      title: `初始化机器人 #${worker.id} ${worker.name}`.slice(0, 100),
      model: { id: worker.modelId, providerID: worker.providerId },
      location: { directory: workdir },
      prompt: await this.buildPrompt(worker),
      timeoutMs: INITIALIZE_TIMEOUT_MS,
    });
    this.assertDone(text);
    this.logger.log(`机器人 #${worker.id} 工作环境已初始化：${workdir}`);
    return { status: 'success', workdir };
  }

  /** 初始化任务指令：AGENTS.md 原文 + 技能库链接 + 规范目录同步要求 + 工位结构约定 */
  private async buildPrompt(worker: Worker): Promise<string> {
    const agents = worker.prompt ?? '';
    const skills = worker.skills ?? [];
    const standards = await this.resolveStandardFiles(worker.standards);
    const skillLines = skills.length
      ? skills
          .map(
            (skill) =>
              `- [${skill.name}](${skill.url})（目录：${skill.path.slice(
                0,
                -'/SKILL.md'.length,
              )}${skill.version ? `，版本：${skill.version}` : ''}）`,
          )
          .join('\n')
      : '（本次清单为空：不保留任何技能目录）';
    const standardLines = standards.directories.length
      ? standards.directories
          .map((directory) => {
            const standard = (worker.standards ?? []).find(
              (item) => item.directory === directory,
            );
            const sourceUrl = standard?.sourceUrl || standard?.url || directory;
            return `- [${standard?.name || directory}](${sourceUrl})（目录：${directory}${
              standard?.version ? `，版本：${standard.version}` : ''
            }）`;
          })
          .join('\n')
      : '（本次规范清单为空：只移除下方清单中记录的旧规范文件，不处理其他文档）';
    const requiredFileLines = standards.files.length
      ? standards.files
          .map(
            (path) =>
              `- [${path}](${standards.rawBase}/${path
                .split('/')
                .map(encodeURIComponent)
                .join('/')})`,
          )
          .join('\n')
      : '（无）';

    return `接下来，更新当前的工作环境：

## 根据以下信息更新AGENTS.md 以下为AGENTS.md 内容

### 工作职责定义
\`\`\`\`markdown
${agents}
\`\`\`\`

### 目录结构

- AGENTS.md    机器人的工作基本原则
- .opencode/   opencode自身的目录
- .opencode/skills/   当前机器人的技能
- .opencode/docs/     当前机器人需要的知识文档等信息内容，opencode可以根据自己完成任务的情况，自行更新总结文档到这里；其中 .standards-manifest.json 是平台维护的规范同步清单
- .opencode/docs/.standards-manifest.json   本次同步的规范文件清单（JSON：{"version":1,"files":[...]}）

### 更新要求

1. 把「工作职责定义」中的 Markdown 原文完整写入当前工作目录的 AGENTS.md；不要改写、缩写或额外发挥。
2. 确保 AGENTS.md 中包含上面的目录结构说明。
3. 保留 .opencode/ 下与本次更新无关的配置；.opencode/docs/ 中不属于规范同步清单的文档不要清空或改写。
4. .opencode/skills/ 以本次技能清单为准：安装或更新清单中的全部技能；移除清单之外的旧技能目录。
5. 安装技能时不要只保存 SKILL.md：按技能目录保持原始结构，并下载技能引用到的脚本、模板等资源文件。
6. .opencode/docs/ 中的规范文档以本次规范清单为准：
   - 如果 .opencode/docs/.standards-manifest.json 存在，先读取其中 files 数组作为旧受管文件清单；不存在或内容非法时旧受管清单视为空。
   - 按下方「需存在的规范文件」下载并写入同名相对路径；保持文件内容与链接内容一致，不要改写或摘要。
   - 只删除「旧受管文件清单中存在、但本次需存在清单中没有」的文件；不要删除机器人或其他流程产生的其他文档。
   - 同步完成后把本次需存在的全部相对路径写入 .opencode/docs/.standards-manifest.json，格式为 {"version":1,"files":[...]}，路径按字典序排序；manifest 自身不要写入 files。
7. 需要创建目录时保持仓库原始目录结构；同名文件以本次规范库内容覆盖。

## 从以下链接中，安装或更新技能

${skillLines}

## 规范清单

${standardLines}

## 需存在的规范文件（左侧为相对 .opencode/docs/ 的路径，右侧为原始文件地址）

${requiredFileLines}

---

### 返回协议

1. 执行过程中的检查、下载和说明不要写入最终回复。
2. 任务成功时，最终回复的正文必须只有一行：DONE；不要附带验证报告，也不要包在代码块里。
3. 任务失败时，最终回复的正文必须只有一行：ERROR: 具体原因。
`;
  }

  /** 解析本次需同步的规范目录与文件清单；规范库不可访问时初始化直接失败 */
  private async resolveStandardFiles(
    standards: Worker['standards'],
  ): Promise<ManagedStandardFiles> {
    try {
      return await this.standardCatalog.resolveManagedFiles(standards);
    } catch (e) {
      throw new BadRequestException(`规范库读取失败：${(e as Error).message}`);
    }
  }

  /**
   * 校验初始化协议输出。
   * 优先接受整段 `DONE`；同时兜底接受独立成行的 DONE（部分模型会先输出验证报告，
   * 再把 DONE 放进代码块）。ERROR 优先于 DONE 判定，避免失败报告被误判成功。
   */
  private assertDone(text: string): void {
    const output = text.trim();
    const error = output.match(/(?:^|\n)\s*(?:`{3,}\s*)?ERROR:\s*([\s\S]+)$/);
    if (error) {
      throw new BadRequestException(
        `工作环境初始化失败：${error[1].replace(/`+$/, '').trim() || '未知错误'}`,
      );
    }
    if (this.hasStandaloneDone(output)) return;
    const summary = this.stripFence(output).replace(/\s+/g, ' ').slice(0, 200);
    throw new BadRequestException(
      summary
        ? `工作环境初始化未返回 DONE：${summary}`
        : '工作环境初始化未返回 DONE',
    );
  }

  /** 判断输出中是否有独立成行的 DONE（允许被代码围栏包裹） */
  private hasStandaloneDone(output: string): boolean {
    if (output === 'DONE') return true;
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .includes('DONE');
  }

  /** 去掉模型偶尔包裹的代码围栏（与 WorkerAiService 相同的兜底） */
  private stripFence(text: string): string {
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
    return (fenced ? fenced[1] : trimmed).trim();
  }
}

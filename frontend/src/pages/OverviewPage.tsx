import { Card, CardHeader, CardTitle, CardDescription } from '@appica/ui-react/card'

interface InfoCard {
  title: string
  description: string
  points: string[]
}

const usageCards: InfoCard[] = [
  {
    title: '搜索项目 → 项目详情',
    description:
      '典型流程：先按名称搜索拿到项目 id，再读项目详情（含文档/检查/用例/任务清单与可执行命令），最后决定运行什么。',
    points: [
      'GET /api/projects/search.md?q={名称关键词}（模糊匹配，前 5 条，含详情链接）',
      'GET /api/projects/{id}.md（项目信息 + 文档/检查/用例/任务清单 + 最近运行结果 + 末尾 AI 操作小节）',
      'GET /api/documents/{docId}.md（文档元信息 + Markdown 正文全文）',
      '原则：用户没给 id 时先搜索，不要猜 id',
    ],
  },
  {
    title: '运行检查 / 用例 / 任务（流式）',
    description:
      'POST 启动一次运行并以 text/markdown 流式返回：先头部信息，运行中逐行追加脚本原始输出，终态附「结果」小节后结束。客户端断开自动退订。',
    points: [
      'curl -N -X POST {BASE}/api/checks/{checkId}/run.md',
      'curl -N -X POST {BASE}/api/tests/{testId}/run.md',
      'curl -N -X POST {BASE}/api/tasks/{taskId}/run.md（手动触发，不受 enabled 限制）',
      '必须带 -N 禁用缓冲逐行读取，无需轮询；长耗时操作直接等流结束',
    ],
  },
  {
    title: '查看运行结果',
    description:
      '判断「上次运行是否正常」时，优先读项目详情中已汇总的最近结果；需要完整过程再取单次运行详情。',
    points: [
      'GET /api/checks/runs/{runId}.md（检查 / 任务的运行详情：元信息 + 结果 + 输出全文）',
      'GET /api/tests/runs/{runId}.md（用例的运行详情）',
      'JSON 兜底 GET .../runs/{runId}；SSE 实时流 GET .../runs/{runId}/stream',
    ],
  },
  {
    title: '全局列表 / 设置 / 脚本更新',
    description:
      '跨项目列举数据走常规 JSON 接口（projectId 可选，不传返回全部）；设置与脚本仓库更新走 .md 视图。',
    points: [
      'GET /api/{checks,tests,documents,tasks,defects}[?projectId=]',
      'GET /api/settings.md（环境 / 脚本目录 / 访问域名 / agent 在线状态）',
      'curl -N -X POST {BASE}/api/settings/scripts/pull.md（脚本仓库 git pull，流式返回）',
    ],
  },
]

const featureCards: InfoCard[] = [
  {
    title: '文档中心',
    description:
      '项目的知识库：同步飞书文档为统一 Markdown，也可在平台内直接编写，供人与 AI 共同阅读。',
    points: [
      '飞书文档同步：支持 docx / sheets / bitable / wiki，单向导入（飞书 → 平台），统一转 Markdown',
      'Markdown 文档：来源「手写」，平台内直接编写与维护',
      '类型：需求 / 功能 / 测试 / 技术 / 接口 / 配置；备注 remark 供 AI 阅读，任何来源都可编辑',
    ],
  },
  {
    title: '脚本调度',
    description:
      '脚本即检查与测试：登记脚本路径后即可运行，实时流式获取执行过程与结果。',
    points: [
      '检查用 .check.ts、测试用 .test.ts，覆盖 H5、后端、APP 三端',
      '脚本仓库：https://github.com/litaGroup/scripts',
      '支持自动导入脚本目录、实时进度（SSE）、运行历史与原始输出回放',
    ],
  },
  {
    title: '定时任务',
    description: '按 crontab 定时执行检查脚本，运行结果自动推送到项目飞书群。',
    points: [
      'crontab 表达式调度（5 段或 6 段），支持启停与手动触发',
      '运行开始 / 终态向项目飞书群推送通知卡片（成功 / 失败 / 异常 / 超时）',
      '运行统计（success / fail / total）一目了然',
    ],
  },
  {
    title: '缺陷流程',
    description:
      '与项目设置的飞书多维表格双向绑定，缺陷从同步、修复到验证闭环管理。',
    points: [
      '飞书 → 平台：一键全量同步（含描述 / 端 / 人员 / 截图）',
      '平台 → 飞书：状态 / 端变更异步回写飞书表格',
      '关联测试脚本，fixed 前须最近一次运行 success，支持一键「运行验证」',
    ],
  },
]

function InfoCardItem({ card }: { card: InfoCard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{card.title}</CardTitle>
        <CardDescription>{card.description}</CardDescription>
      </CardHeader>
      <ul className="flex flex-col gap-2 px-6 pb-6 group-data-inset/card:px-4">
        {card.points.map((p) => (
          <li
            key={p}
            className="flex gap-2 text-sm text-foreground-muted"
          >
            <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground-muted" />
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** 命令行片段块（可复制） */
function CommandBlock({ command }: { command: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-background-muted px-3 py-2 text-sm whitespace-pre-wrap">
      <code>{command}</code>
    </pre>
  )
}

function SkillInstallSection() {
  const origin = window.location.origin
  const skillUrl = `${origin}/SKILL.md`
  const installCmd = `mkdir -p ~/.opencode/skills/project-manage && curl -fsSL ${skillUrl} -o ~/.opencode/skills/project-manage/SKILL.md`

  return (
    <section>
      <h2 className="mb-4 text-xl font-semibold">安装 SKILL（让 Agent 学会操作本平台）</h2>
      <Card>
        <CardHeader>
          <CardTitle>project-manage 技能</CardTitle>
          <CardDescription>
            技能说明随平台代码维护，涵盖：搜索项目、读取项目详情与文档正文、运行检查/用例/任务并流式获取结果、查看设置与更新脚本仓库。安装后 Agent 会话可直接按技能说明操作本平台。
          </CardDescription>
        </CardHeader>
        <div className="flex flex-col gap-4 px-6 pb-6 group-data-inset/card:px-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">1. 在线地址（SKILL 文件本体）</p>
            <a
              href={skillUrl}
              target="_blank"
              rel="noreferrer"
              className="w-fit text-sm text-foreground-intense underline"
            >
              {skillUrl}
            </a>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">2. 安装到 opencode（推荐）</p>
            <CommandBlock command={installCmd} />
            <p className="text-sm text-foreground-muted">
              安装后重启会话即可生效；SKILL 随平台迭代，需要更新时重新执行上面的命令覆盖即可。
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">3. 免安装直接使用</p>
            <p className="text-sm text-foreground-muted">
              也可以不安装，直接告诉 Agent：「读取 {skillUrl}，按说明操作项目管理平台」。
            </p>
          </div>
        </div>
      </Card>
    </section>
  )
}

export function OverviewPage() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <h1 className="mb-4 text-2xl font-semibold">概览</h1>
        <p className="mb-4 text-sm text-foreground-muted">
          以 AI 为中心的项目管理平台：AI（agent 会话）是核心参与者而非附属功能，所有能力都通过 HTTP API 暴露，agent 可直接读写并流式获取运行结果。
        </p>
      </section>

      <SkillInstallSection />

      <section>
        <h2 className="mb-4 text-xl font-semibold">常用使用方法</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {usageCards.map((card) => (
            <InfoCardItem key={card.title} card={card} />
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">核心功能</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {featureCards.map((card) => (
            <InfoCardItem key={card.title} card={card} />
          ))}
        </div>
      </section>
    </div>
  )
}

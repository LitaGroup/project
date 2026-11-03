关于任务详情页：

任务详情页，已对话的方式，基于 [assistant-ui](https://www.assistant-ui.com/) 来实现，详情页分为左右两栏：

1. 左侧面板，是聊天页，基于 [assistant-ui](https://www.assistant-ui.com/) 实现，通过SSE 与后端链接，任务的实时反馈都可以到该页面上，这里需要注意一下：任务可能由多个机器人完成，因此，不同的机器人使用不同的头像和名称来答复
2. 右侧面板，是任务的详情、任务的PIPELINE（多个机器人的任务清单在这里）、任务的交付物（包括中间机器人的交付物）





增加 `知识` 板块

1. 知识的本质是 markdown 内容
2. 知识是允许有路径的，比如：
   1. http://{host}/docs/detail/a/b/c/d 获取到 路径为 `/a/b/c/d` 的文章，而 `http://{host}/docs/detail/a/b/c/` 则获取到对应的这个目录，返回目录下的所有文章和子目录
   2. http://{host}/api/docs/detail/a/b/c/d.md 获取到为 `/a/b/c/d` 的文章markdown内容，而 `http://{host}/api/docs/detail/a/b/c/.md` 则获取到对应的这个目录，返回目录下的所有文章和子目录
3. 知识 的存储使用 PostgreSQL 来实现，启用 全文 pgvector
4. 提供知识的搜索能力，通过PGVector和全文检索来实现 RAG
5. 对外提供知识的搜索SKILL，提供给Agent使用
6. 项目中的文档，同步存储到 知识 中，并同步更新（或者正文部分直接存储到知识中，原 文档中不再单独存一份），存储的路径为：
   1. http://{host}/api/docs/detail/project/{project id}/document/{document id}.md

7. 对应 PostgreSQL的账号密码和地址，在 .env 环境变量中
   1. PROJECT_PG_HOST 
   2. PROJECT_PG_PASSWORD
   3. PROJECT_PG_USER
   4. PROJECT_PG_PORT
   5. PROJECT_PG_DATABASE





export PROJECT_KNOWLEDGE_EMBEDDING_BASE_URL=https://llm-bimi1zkosmowhfri.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
export PROJECT_KNOWLEDGE_EMBEDDING_API_KEY=sk-ws-H.YDXLHEI.NsvT.MEUCIQD2Pn6X7n0xJdoTGBgj1toNNgdbqNggMzE07Q43XGnqFQIgbUxuJl8KgQHSwaVlceYsDkB_Z_llBltAP_c7StBUN3U
export PROJECT_KNOWLEDGE_EMBEDDING_MODEL=qwen3.7-text-embedding
export PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS=1024





PROJECT_KNOWLEDGE_EMBEDDING_BASE_URL

PROJECT_KNOWLEDGE_EMBEDDING_API_KEY

PROJECT_KNOWLEDGE_EMBEDDING_MODEL

PROJECT_KNOWLEDGE_EMBEDDING_DIMENSIONS







搜索接口，增加一个参数：source - 数据源，支持：

- feishu - 直接调用飞书的搜索接口，来搜索，返回的数据需要转换成markdown，同步提供给外部一个接口，可以转换飞书文档为markdown返回
- project - 当前站内的内容搜索
- all - 同时搜索两个源，各返回前 n 条内容



搜索支持分页，最大条数返回100条





完成两个任务：

1. 业务重构，我想让数据库都走 postgreSQL 来代替当前的mysql，帮我完成重构，并将数据导入到postgresql中

2. 在`任务` 模块下，增加一个`调试` 导航，是一个可以调试机器人的对话页面，需要选择对应的机器人



- 机器人，增加一个头像，如果没有头像，则默认显示一张黑图+一圈边框
- 页面优化，任务详情页（/tasks/17）UI展示出来的时间太长，可以先展示UI，后面再加载数据



创建机器人/更新机器人后，增加一个初始化的过程：

1. 创建/更新 AGENTS.md
2. 初始化工作目录（.opencode 以及 SKILLS）
3. 





---

顶部导航栏，导航的左边，跟 内容区的左侧对齐

左侧 任务列表，去掉  边线，`任务列表` 部分的内容改成：`我的任务`，样式参考：

```
    --color-black: #000;
    --color-white: #fff;
    --spacing: .25rem;
    --container-2xs: 18rem;
    --container-xs: 20rem;
    --container-sm: 24rem;
    --container-md: 28rem;
    --container-xl: 36rem;
    --container-2xl: 42rem;
    --container-3xl: 48rem;
    --text-sm: .875rem;
    --font-weight-normal: 400;
    --font-weight-medium: 500;
    --font-weight-semibold: 600;
    --tracking-tight: -.025em;
    --tracking-wide: .025em;
    --tracking-wider: .05em;
    --tracking-widest: .1em;
    --leading-relaxed: 1.625;
    --shadow-sm: 0 2px 8px -2px var(--shadow-color);
    --shadow-md: 0 4px 8px -2px var(--shadow-color);
    --shadow-2xl: 0 24px 32px -12px var(--shadow-color);
    --ease-in: cubic-bezier(.4, 0, 1, 1);
    --ease-out: cubic-bezier(0, 0, .2, 1);
    --ease-in-out: cubic-bezier(.4, 0, .2, 1);
    --animate-pulse: pulse 2s cubic-bezier(.4, 0, .6, 1) infinite;
    --blur-xs: 4px;
    --blur-sm: 8px;
    --blur-md: 12px;
    --blur-lg: 16px;
    --blur-xl: 24px;
    --blur-2xl: 40px;
    --blur-3xl: 64px;
    --aspect-video: 16 / 9;
    --default-transition-duration: .15s;
    --default-transition-timing-function: cubic-bezier(.4, 0, .2, 1);
    --default-font-family: var(--font-sans);
    --default-mono-font-family: var(--font-mono);
    --color-background: var(--background);
    --color-border-intense: var(--border-intense);
    --color-primary: var(--primary);
    --color-lime-500: lab(75.3197% -46.6547 86.1778);
    --color-violet-500: lab(49.9355% 55.1776 -81.8963);
    --color-pink-500: lab(56.9303% 76.8162 -8.07021);
    --color-slate-100: lab(96.286% -.852436 -2.46847);
    --color-slate-600: lab(35.5623% -1.74978 -15.4316);
    --color-slate-900: lab(7.78673% 1.82345 -15.0537);
    --color-slate-950: lab(1.76974% 1.32743 -9.28855);
    --color-gray-100: lab(96.1596% -.0823438 -1.13575);
    --color-gray-700: lab(27.1134% -.956401 -12.3224);
    --color-gray-900: lab(8.11897% .811279 -12.254);
    --color-gray-950: lab(1.90334% .278696 -5.48866);
    --color-zinc-100: lab(96.1634% .0993311 -.364041);
    --color-zinc-900: lab(8.30603% .618205 -2.16572);
    --color-zinc-950: lab(2.51107% .242703 -.886115);
    --color-neutral-100: lab(96.52% -.0000298023 .0000119209);
    --color-neutral-900: lab(7.78201% -.0000149012 0);
    --color-neutral-950: lab(2.75381% 0 0);
    --color-stone-100: lab(96.5286% -.0991821 .364268);
    --color-stone-900: lab(9.03835% 1.15298 1.92955);
    --color-stone-950: lab(2.86037% .455312 .568903);
    -webkit-text-size-adjust: 100%;
    tab-size: 4;
    font-feature-settings: var(--default-font-feature-settings,normal);
    font-variation-settings: var(--default-font-variation-settings,normal);
    -webkit-tap-highlight-color: transparent;
    --font-geist: "Geist", "Geist Fallback";
    --font-geist-mono: "Geist Mono", "Geist Mono Fallback";
    --font-inter: "Inter", "Inter Fallback";
    --font-figtree: "Figtree", "Figtree Fallback";
    --font-urbanist: "Urbanist", "Urbanist Fallback";
    --font-dm-sans: "DM Sans", "DM Sans Fallback";
    --font-outfit: "Outfit", "Outfit Fallback";
    --font-google-sans: "Google Sans";
    --font-manrope: "Manrope", "Manrope Fallback";
    --font-fraunces: "Fraunces", "Fraunces Fallback";
    --font-public-sans: "Public Sans", "Public Sans Fallback";
    --font-instrument-sans: "Instrument Sans", "Instrument Sans Fallback";
    --font-host-grotesk: "Host Grotesk", "Host Grotesk Fallback";
    --font-jetbrains-mono: "JetBrains Mono", "JetBrains Mono Fallback";
    --border-width: 1px;
    --radius: .875rem;
    --radius-4xs: calc(var(--radius) * 2 / 7);
    --radius-3xs: calc(var(--radius) * 3 / 7);
    --radius-2xs: calc(var(--radius) * 4 / 7);
    --radius-xs: calc(var(--radius) * 5 / 7);
    --radius-sm: calc(var(--radius) * 6 / 7);
    --radius-md: var(--radius);
    --radius-lg: calc(var(--radius) * 8 / 7);
    --radius-xl: calc(var(--radius) * 9 / 7);
    --radius-2xl: calc(var(--radius) * 12 / 7);
    --radius-3xl: calc(var(--radius) * 16 / 7);
    --radius-4xl: calc(var(--radius) * 20 / 7);
    --opacity-disabled: .65;
    --ease-spring: cubic-bezier(.175, .885, .32, 1.5);
    --foreground: lab(35.6337% -1.58697 -10.8425);
    --foreground-subtle: lab(65.9269% -.832707 -8.17473);
    --foreground-muted: lab(47.7841% -.393182 -10.0268);
    --foreground-strong: lab(27.1134% -.956401 -12.3224);
    --foreground-emphasis: lab(16.1051% -1.18239 -11.7533);
    --foreground-intense: lab(8.11897% .811279 -12.254);
    --foreground-inverse: lab(100% 0 0);
    --background: lab(100% 0 0);
    --background-subtle: lab(98.2596% -.247031 -.706708);
    --background-muted: lab(96.1596% -.0823438 -1.13575);
    --background-strong: lab(91.6229% -.159115 -2.26791);
    --background-inverse: lab(1.90334% .278696 -5.48866);
    --border: lab(91.6229% -.159115 -2.26791);
    --border-muted: lab(96.1596% -.0823438 -1.13575);
    --border-strong: lab(85.1236% -.612259 -3.7138);
    --border-emphasis: lab(65.9269% -.832707 -8.17473);
    --border-intense: lab(47.7841% -.393182 -10.0268);
    --border-inverse: lab(16.1051% -1.18239 -11.7533);
    --border-overlay: lab(96.1596% -.0823438 -1.13575);
    --primary: lab(8.11897% .811279 -12.254);
    --primary-subtle: lab(96.1596% -.0823438 -1.13575);
    --primary-soft: lab(91.6229% -.159115 -2.26791);
    --primary-muted: lab(27.1134% -.956401 -12.3224);
    --primary-strong: lab(1.90334% .278696 -5.48866);
    --primary-foreground: lab(100% 0 0);
    --secondary: lab(77.5052% -6.4629 -36.42);
    --secondary-subtle: lab(54.1736% 13.3369 -74.6839/.1);
    --secondary-soft: lab(54.1736% 13.3369 -74.6839/.2);
    --secondary-muted: lab(86.15% -4.04379 -21.0797);
    --secondary-strong: lab(65.0361% -1.42065 -56.9802);
    --secondary-emphasis: lab(54.1736% 13.3369 -74.6839);
    --secondary-intense: lab(44.0605% 29.0279 -86.0352);
    --secondary-foreground: lab(1.90334% .278696 -5.48866);
    --error: lab(76.5514% 36.422 15.5335);
    --error-subtle: lab(55.4814% 75.0732 48.8528/.1);
    --error-soft: lab(55.4814% 75.0732 48.8528/.2);
    --error-muted: lab(86.017% 19.8815 7.75869);
    --error-strong: lab(63.7053% 60.745 31.3109);
    --error-emphasis: lab(55.4814% 75.0732 48.8528);
    --error-intense: lab(48.4493% 77.4328 61.5452);
    --error-foreground: lab(1.90334% .278696 -5.48866);
    --success: lab(83.9203% -48.7124 13.8849);
    --success-subtle: lab(66.9756% -58.27 19.5419/.1);
    --success-soft: lab(66.9756% -58.27 19.5419/.2);
    --success-muted: lab(90.2247% -31.039 9.47084);
    --success-strong: lab(75.0771% -60.7313 19.4147);
    --success-emphasis: lab(66.9756% -58.27 19.5419);
    --success-intense: lab(55.0481% -49.9246 15.93);
    --success-foreground: lab(1.90334% .278696 -5.48866);
    --warning: lab(80.8059% 21.7313 50.4455);
    --warning-subtle: lab(64.272% 57.1788 90.3583/.1);
    --warning-soft: lab(64.272% 57.1788 90.3583/.2);
    --warning-muted: lab(88.4871% 9.94918 28.8378);
    --warning-strong: lab(70.0429% 42.5156 75.8207);
    --warning-emphasis: lab(64.272% 57.1788 90.3583);
    --warning-intense: lab(57.1026% 64.2584 89.8886);
    --warning-foreground: lab(1.90334% .278696 -5.48866);
    --info: lab(80.3307% -20.2945 -31.385);
    --info-subtle: lab(63.3038% -18.433 -51.0407/.1);
    --info-soft: lab(63.3038% -18.433 -51.0407/.2);
    --info-muted: lab(88.6983% -11.3978 -16.8488);
    --info-strong: lab(70.687% -23.6078 -45.9483);
    --info-emphasis: lab(63.3038% -18.433 -51.0407);
    --info-intense: lab(51.7754% -11.4712 -49.8349);
    --info-foreground: lab(1.90334% .278696 -5.48866);
    --focus-ring: lab(85.1236% -.612259 -3.7138);
    --focus-ring-input: lab(91.6229% -.159115 -2.26791);
    --focus-ring-primary: lab(85.1236% -.612259 -3.7138);
    --focus-ring-secondary: lab(54.1736% 13.3369 -74.6839/.3);
    --focus-ring-error: lab(55.4814% 75.0732 48.8528/.3);
    --focus-ring-success: lab(66.9756% -58.27 19.5419/.3);
    --focus-ring-warning: lab(64.272% 57.1788 90.3583/.3);
    --focus-ring-info: lab(63.3038% -18.433 -51.0407/.3);
    --focus-ring-light: lab(100% 0 0/.25);
    --shadow-color: lab(47.7841% -.393182 -10.0268/.18);
    --selection-color: lab(1.90334% .278696 -5.48866/.1);
    --font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif;
    --font-mono: var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace;
    color-scheme: light;
    -webkit-font-smoothing: antialiased;
    --scroll-area-corner-height: 0px;
    --scroll-area-corner-width: 0px;
    box-sizing: border-box;
    border: 0 solid;
    margin: 0;
    padding: 0;
    border-color: var(--border);
    font-weight: inherit;
    margin-bottom: calc(var(--spacing) * 2);
    padding-inline: calc(var(--spacing) * 3);
    font-family: var(--font-mono);
    font-size: .875rem;
    line-height: var(--tw-leading,1.25rem);
    color: var(--foreground-subtle);
```



右边数字的部分，使用

<Badge>Badge</Badge>







AI交互 里面：

1. `技术-后端开发工程师-ADMIN专家机器人2026/11/2 11:07:47` 这个标题里面，去掉`机器人` 和 `时间` 部分，时间地方替换为 耗时的时长，比如：`xx分钟/xx秒`
2. AI返回的聊天不要用 圆角的边框 和 线

---



最下方的按钮：

- 复盘 - 任务状态为 验收通过后、关闭后 有效，其它 disabled
- 交付 - 任务 进行中 有效，验收中 时，文案为：撤销交付，验收之后为 disabled
- 分配 - 任务 进行中 有效，验收中 时
- `+子任务` - 创建子任务，提交验收之前有效
- 发送 - 一直有效，可以发送消息与AI交互 

--- 以上待验收 ---



去掉： AI 交互 标题栏下面的线

去掉：聊天输入框 上边 和 正文 之间的线

去掉：聊天输入框内 按钮 和 输入内容中间的线

状态 部分 迁移 到`AI 交互` 标题栏的右侧，`8条` 这里去掉



AI 聊天的内容，支持：markdown 





项目的总标题：`AI项目管理平台` -> `Lita 工作中心`，默认的访问地址：http://work.cinta.team   

右侧的导航的`操作台` -> `工作台`

工作台：当前 `项目` 不应该是选中的状态

---

接下来，我描述一下，工作台的工作模式：



先约定：

>  凡事描述“我”的地方，都表示：当前登录用户的代理机器人。



1. 工作台，只受理  我 作为任务的 发起者（=需求者）、负责者 的任务
2. 右侧的AI工作台，有两个TAB：任务会话、我的AGENT
3. 任务会话：直接作为任务的消息体，发布消息，发布后的消息，由任务的会话逻辑处理
4. 我的AGENT：则直接与自己的AGENT 进行会话，通过AGENT的技能的调用来操作任务

---



`我的AGENT` 和 `任务会话` AI交互面板一致，除了以下几处：



1. `我的AGENT`  下方的按钮排列为：
   1. "+" 文件上传
   2. 模型 选择下拉 + 思考等级 选择
   3. 发送消息按钮，只需要一个朝上的箭头即可
2. `任务会话` 下方的按钮，需要区分 任务的发起者 和 负责者
   1. 发起者：
      1. 验收通过 - 待验收状态时 为有效，其它无效；
      2. 新子任务 - 这个任务再创建一个子任务
      3. 分配任务 - 这个任务重新分配给其它人
      4. 取消任务 - 取消这个任务
   2. 负责者：
      1. 发起交付 
      2. 分配任务 - 这个任务重新分配给其它人
      3. 新子任务 - 这个任务再创建一个子任务
      4. 拒绝任务 - 不受理这个任务



以上按钮，都只用 ICON + 鼠标移上去后 弹出提示消息，帮我挑选ICON

---



我的想法是：TAB 部分，改为： `任务-需求者` `任务-负责者` `我的AI` 

- 如果，这个任务，我是需求者，则展示 `任务-需求者`，否则不展示
- 如果，这个任务，我是负责者，则展示 `任务-负责者`，否则不展示







接下来，约定 `我的AI` 的逻辑：

1. 支不支持：plan 模式 和 build 模式 ？？？
2. 每一个 任务下的 AI 都是一个独立的SESSION
3. 右上角`个人中心` 下面增加一个 链接 `我的机器人`，进入 机器人的配置页，里面可以配置：技能、规范、AGENTS.md、执行器
   1. 这个机器人 是 `我的AI` 实际沟通的AGENT
   2. 任务中机器人的实际执行，还是真人
4. 





顶部导航，`添加` 按钮，鼠标移上去之后的显示为：`新建任务、工单`，快捷键：`command + n` 



再统一一下名称：

- 需求者、需求、需求方、来源方 -> 需求方

- 责任方、责任者、负责人、执行方 -> 执行方



接受任务的按钮，迁移到 执行方 聊天框最下面的 按钮区



---

workbench 页面中，左侧的任务列表，保持 文字内容位置不变，选中后的背景，改为跟导航一致的 同样有左右边距的背景

---



所有的按钮、Tab标签、可点击的任务部分，鼠标移上去之后，统一变成手势。

---

整体把流程过一遍：创建任务、技术工单

---



1、发起交付页的优化（现在是4个输入框，优化成1个？还是说，交付的流程需要优化一下）



---

还有一个问题，子任务 发起 question，需要父任务的执行方（也就是子任务的需求方）来回答，这里也会卡主



任务完成后，发送给用户的飞书消息里面的链接，从 任务详情页 替换为 工作区 内对应的这个任务的详情页






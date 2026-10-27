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










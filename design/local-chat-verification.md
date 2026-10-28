# Docker 本地真实对话验证

2026-10-28；分支 `ui-design-update`。

## 本轮结论

由 Agent 执行 7 轮真实模型对话，覆盖原会话继续追问、长表格、真实 question 单选/多选/自由输入、确认回执、原生 todowrite、执行期间草稿及发送失败。另有用户自行体验的对话，均保留在隔离数据库中。

只修改 `WorkerDebugPage.tsx` 的 assistant-ui 呈现适配器：

- 发送失败时，用现有库的 `MessageNotSentError` 恢复未发送草稿，沿用原错误提示和发送回调。不会自动重试。
- 向外部运行时传入已有 `running` 状态，让用户从历史消息发送新一轮后，视口能跟随新回复。

`WorkerDebugPage` 的快照、SSE、send/reply/reset、API 调用和发送限制保持原样；任务详情与看板没有修改。范围审查对 `onNew` 仅允许上述精确的失败分类包装，其余原语句必须一致。

## 实测证据

| 场景 | 修改前 | 修改后 |
|---|---|---|
| 单次发送失败 | 输入框清空，草稿丢失 | 原文恢复；手动重试仍发送原文 |
| 阅读顶部历史后发新消息 | scrollTop 保持 0，新回复在视口外 | 新轮滚动到 4720/4720，完成时 4737/4737 |
| 多轮追问 | 原会话正常 | 同一会话继续正常，记住最初选择的“表格” |
| 实际 question 确认 | 单选正常 | 多选两项 + 自由输入正确回传；回执排在最终结果之前 |
| 等待确认期间输入草稿 | — | 草稿保留至完成；等待期间发送禁用，完成后可发送 |
| 运行时消息与待确认区 | — | 10 条实际助手回复对应 10 个助手节点；待确认只出现一次，完成后移出 |

真实模型和 SSE 使用原接口。仅“发送失败”测试在浏览器中拦截一次发送请求并返回 HTTP 500，此请求未到达后端；其余回复、问题和待办均来自本地后端与真实执行器，未使用消息 fixtures。

[机器记录](./local-chat-verification.json) · [真实对话截图](./screenshots/local-chat/docker-real-chat.png)。

验证：前端 TypeScript、变更文件 oxlint、Vite 构建通过；24 项主分支范围审查和 7 项消息展示投影测试通过。构建仍有原有大分包提示。最终真实轮次无页面横向溢出，会话回到 idle，无执行错误。

## 本地环境与入口

实际 UI：[http://127.0.0.1:5275/tasks/workers/1001/debug](http://127.0.0.1:5275/tasks/workers/1001/debug)。原有 `5274` 页面继续作为只读 fixtures 预览，和真实运行入口分开。

5 个任务专属容器均带标签 `com.codex.task=square-ui-local`：

| 容器 | 用途 | 绑定与数据 |
|---|---|---|
| `square-ui-local-web` | 当前前端构建 + 固定 API 代理 | 仅 `127.0.0.1:5275` |
| `square-ui-local-entry` | 原 Vite 页的本地 API 入口 | 仅 `127.0.0.1:3100` |
| `square-ui-local-backend` | 未修改的后端编译产物 | 仅内部网络，无宿主端口 |
| `square-ui-local-postgres` | 独立 PostgreSQL 16 | `square-ui-local-postgres-data` volume |
| `square-ui-local-executor` | 官方 OpenCode 2.1.4 Linux 执行器 | `square-ui-local-executor-home`、`square-ui-local-workers` volumes |

数据库和后端只接内部 Docker 网络。后端没有加载生产环境文件；飞书、GitHub、Lita 集成令牌留空。执行器仅沿用已有 DeepSeek 模型接口，真实推理会访问该模型服务；模型的 shell、外部目录、网页请求和子代理工具禁用。没有发送线上机器人消息或修改线上业务数据。

新增运行资源集中在这 5 个容器、3 个 volume 和 `work/local-runtime/`。本机现有依赖只读挂载，未安装或替换本机数据库、执行器或全局配置。已有其他服务和 Docker 全局设置保持原样。`work/local-runtime/.gitignore` 将本地凭据、JWT、配置、数据和构建产物全部排除；这些内容不提交。

本地登录使用隔离测试账号，当前测试凭证有效期约 8 小时。有效期内可访问 `http://127.0.0.1:5275/__local_ui_login` 恢复登录 cookie；该入口不会延长凭证有效期。辅助入口仅存在于本机 Docker 代理中，没有加入产品认证代码。

## 停止与恢复

仅停止本任务容器，保留会话数据：

```sh
docker stop square-ui-local-web square-ui-local-entry square-ui-local-backend square-ui-local-executor square-ui-local-postgres
```

恢复时先启动数据库，确认 healthy 后再启动其余容器：

```sh
docker start square-ui-local-postgres
docker inspect --format '{{.State.Health.Status}}' square-ui-local-postgres
docker start square-ui-local-executor square-ui-local-backend square-ui-local-entry square-ui-local-web
```

当前有效运行时和 3 个 volume 保留，供继续体验。两张活动镜像约 639 MB、volume 约 74 MB，执行器二进制约 223 MiB；这些资源仍在使用。一次性下载包、初始化/检查脚本及重复构建在留档后清理；未执行全局 Docker 或缓存清理。

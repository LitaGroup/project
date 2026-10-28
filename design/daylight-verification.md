# 日间 UI 验收记录

2026-10-28；已合并主分支 `ac49bd2`。见 [本次范围审查](./main-merge-review.md)、[浏览器报告](./daylight-verification.json) 与 [视频源文件指纹](./conversation-video-verification.json)。

## 检查结果

- 消息展示投影：**7/7** 回归通过。
- 对话与响应式浏览器验收：**21/21** 通过，页面错误与未匹配 API 均为0。
- 全站页面：**69/69** 采集通过，全部主题为 light，页面错误、额外写请求与主区横向溢出检查通过。[页面报告](./daylight-pages.json)
- 前端 TypeScript、oxlint、Vite 构建、后端类型检查、24项源码范围审计与 diff check 通过。构建存在原有 >500kB 分包提示，未影响成功。

## 对话场景

验证执行彩环 → 待确认黄色柔光 → 提交回答 → 绿色完成 → 原会话继续追问；原始 `[用户, 助手最终回复, 已回答问题]` 在视图中显示为 `[用户, 确认记录, 最终回复]`。重复问题 ID 只有一张卡片。

HTTP500 后保留自由输入和选择；重试的 answers 内容不变。多问题、多选与跳过分别验证原请求；空会话、错误、已失效问题、历史回复不重播完成光效及最近待办语义通过。调试页 idle 时仍可回答真实 pending 提问；任务页保留 main 的待反馈与所属任务限制。运行时继续保留原发送禁用规则。

尺寸覆盖1920×1080、1440×1000、1024×900、768×1000、390×844、360×800、360×640。最后两项独立检查聊天区至少64px、输入区完整在屏幕内；实测360×640聊天区65px、问题区116px，390×844聊天区97px、问题区158px。确认卡和输入框边缘对齐，完整边框与提交区保持可见。危险按钮对比度6.29:1。

新增状态动效验收：待确认和完成各闪烁3次、每次720ms；边框与外发光发生真实变化，正文与尺寸保持稳定，结束后保留静态柔光。重复的 pending 快照不会重播已结束的闪烁；从待确认切换完成会独立播放绿色闪烁。

确认卡位置与底色复核：问题内容独立滚动，标题、原提交/跳过动作固定，输入与回执逻辑保持原样。[响应式定位报告](./approval-layout-verification.json)

卡片扫光清理：移除卡片指针高光、普通边缘扫光、按钮表面扫光及状态文字渐变扫光；原 Gemini 执行彩环、三次状态提示、数字转轮与操作保持。5项源码检查与29项专门浏览器检查通过，另验证2个现有交互样例。[清理验收](./quiet-surfaces-verification.json)

## 正式成果

- [日间截图索引](./daylight.html)
- [对话总览视频](./screenshots/daylight/conversation-overview.mp4)：17.2秒，1920×1080，H.264/30fps/yuv420p，静音AAC；完整解码通过、无黑帧间隙。
- `screenshots/daylight/worker-running.png`、`worker-confirm.png`、`worker-complete.png`、`worker-followup.png`：四个关键状态。
- `screenshots/daylight/pages/`：全站页面与状态。
- [合并主分支后的最终范围审查](./main-merge-review.md)

## 复现

运行前端开发服务后执行：

```sh
node --test design/preview/conversation-presentation.test.mjs
node design/preview/daylight-check.mjs --base=http://localhost:5273
node design/preview/capture.mjs --report=design/daylight-pages.json --output=design/screenshots/daylight/pages
```

录屏使用 `node design/preview/daylight-check.mjs --record --only=flow --report=work/daylight/recording.json`，再以现有 ffmpeg 转换为正式MP4并检查解码。浏览器全部使用隔离虚构数据，所有 API 被拦截，不进入业务库。临时原始视频和构建产物验证后清理；源码、正式截图/视频和验收报告保留。

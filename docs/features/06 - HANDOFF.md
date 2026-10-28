# 任务交付与复盘文档



任务点击`验收` 后，形成 任务 总结移交文档



1. 调用 机器人做自我总结，我总结后的文档，形成 REPORT，并上传到 project 知识库中，并将总结报告返回到聊天记录中
2. 总结报告的命名：task/handoff/{date}/{task-id}/{version}.md  其中 version 从0 开始，没生成一次，加1；date 格式为：yyyyMMdd
3. 任务相关形成的文档重新调整一下命名和路径，且去掉 版本 部分
   1. task/{date}/{task-id}/REVIEW.md  复盘文档
   2. task/{date}/{task-id}/HANDOFF.md  交付文档
4. 总结报告要求包含的内容：
   1. 任务的原始输入、任务的整理后的输入
   2. 任务的交付物与结论
   3. 任务的统计数据：用户确认了多少次、补充了多少次信息、持续了多长时间
   4. 任务的记录：中间走了哪些弯路、总结了哪些经验
   5. 总结的经验：总结了哪些经验

---



单任务的任务流

```mermaid	
flowchart TD
    A[创建任务] -->|任务识别、分配| B{任务处理}
    B -->|询问| C(父任务答复 / 任务创建人答复)
    C -->|答复| B
    B -->|申请验收| D(等待验收)
    D -->|验收通过| E(总结复盘)
    D -->|验收不过，提供反馈| B
```

任务的几个关键的定义：

1. 任务需求方 - 提出需求的  人  或者  机器人，需求方可以是人 也可以是 机器人
2. 任务机器人 - 当前执行这个任务的机器人
3. 任务负责人 - 负责这个任务执行的机器人的负责人



任务上升机制，如果任务超过3次无法验收通过，则任务状态交由 任务负责人 来完成



新增任务交付文档：

1. 任务在执行提交验收时，需要提供一个交付文档，交付文档通过 project 的 文档来创建或者更新
2. 文档的命名格式为：task/deliver/{date}/{task-id}/deliver.md
3. 文档的标题为：{taskid}-{xxxxxx}-交付文档

交付文档创建完成后，可以申请验收（调用 申请验收的接口来实现）



---



## 多机器人协同作业



原则：

1. 一个任务 有且只有一个 机器人负责、一个需求方（可以是 人 或者 机器人）
2. 任务来源有两种：人 创建的 或者 机器人分发的
3. 同一时间，一个机器人只能处理一个任务
   1. 如果任务处于 等待状态，可以接受新任务，



任务创建原则：根据 `任务定义` 来判断是否需要创建子任务

任务的状态图更新：

```mermaid
flowchart TD
    NONE[无] -->|创建| READY(等待中-待分配)
    READY -->|分配| WAITING_ACCEPT(等待中-待接受)
    WAITING_ACCEPT -->|接受| RUNNING(进行中)
    WAITING_ACCEPT -->|拒绝| FINISH_REFUSED(结束-已拒绝)
    RUNNING -->|询问| WAITING_REPLY(等待中-待反馈)
    RUNNING -->|验收申请| WAITING_HANDOFF(等待中-待验收)
    WAITING_HANDOFF -->|验收拒绝| RUNNING
    WAITING_HANDOFF -->|验收通过| FINISH_DONE(结束-已完成)
    WAITING_HANDOFF -->|任务失败| FINISH_FAIL(结束-失败)
    WAITING_REPLY -->|答复| WAITING_RESUME(等待中-待继续)
    WAITING_RESUME --> |继续|RUNNING
```

1. task-defines   当前系统支持分发的任务类型
2. task-create 创建子任务
3. task-refuse  任务拒绝，表示这个任务不是我能处理的范围，并给出拒绝理由和分发建议
4. task-fail  任务失败，仅由任务的需求方可以完成
5. task-accept 接受任务
6. task-question-ask  代替opencode的询问，由 project 接管，并展示和判断UI
7. task-question-answer  答复消息，并更改任务状态为
8. task-handoff-apply 任务验收申请
9. task-handoff-accept 任务验收通过
10. task-handoff-refuse 任务验收失败



由LOOP来接手等待中的任务，并驱动进行下一步，需要判断当前机器人的状态，如果是等待，则可以安排，否则继续等待



在写入 AGENTS.md 的时候，需要加上 以上子任务的使用的逻辑，并告诉AGENTS.md 如果有不匹配自己的任务可以在`等待中-待接受`阶段拒绝任务。

---

## 当前已实现说明（2026-10-28）

1. 任务执行成功不会自动进入待验收，执行机器人必须调用 `POST /api/tasks/:id/deliver/apply.md`（`X-Worker-Token`）申请验收，同时生成/覆盖交付文档 `/task/{yyyyMMdd}/{task.code}/HANDOFF.md`。
2. 需求方通过网页「完成」或 `POST /api/tasks/:id/deliver/reply.md` 的 `accept` 验收，通过后异步生成 `REVIEW.md`；只有任务需求方可以操作。
3. 验收不通过通过网页「验收不通过」或 `POST /api/tasks/:id/reject` 提交反馈，计入 `tasks.acceptRejectCount`。第 1～3 次退回原机器人，第 4 次起转「等待中-待反馈」并记录/通知执行机器人负责人。
4. 任务负责人提交反馈后重新识别并派发机器人；验收计数与接管快照保留。
5. 子任务机器人提问优先由直接父任务机器人自动答复：平台使用父机器人执行器、模型和工位创建一次性独立咨询会话，不干扰父任务执行状态；无可用父机器人或自动答复失败时，通知任务需求方人工回答。
6. 任务详情展示验收不通过次数、负责人接管信息，以及父任务机器人自动答复中/失败状态。
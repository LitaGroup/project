---
description: "> AI 助手提示：本文件定义了本项目前端 UI 硬性规范——按钮操作反馈统一用 Popover（成功停留 2 秒进入下一步、失败展示消息停留 5 秒），Markdown 编辑器与展示区外框一律方角。在实现或修改相关 UI 前务必遵循。"
version: 1.0.2
type: docs
---

# 前端 UI 规范

> **AI 助手提示**：本文件是本项目（project 平台前端）的 UI 硬性规范，仅适用于本项目。在实现或修改任何按钮反馈、Markdown 编辑/展示界面之前，必须先遵循本规范；与其它建议冲突时以本文件为准。

---

## 一、适用范围

- 本项目 `frontend/` 下全部页面与组件（Appica UI：`@appica/ui-react`，React 19 + Tailwind CSS v4）
- **仅适用于本项目**，不作为团队全局规范下发

## 二、规范一：按钮操作反馈统一用 Popover

### 2.1 核心规则

| 结果 | 气泡内容 | 停留时长 | 结束后的行为 |
|:---|:---|:---|:---|
| 成功 | 成功标题 + 一句话结果描述 | **2 秒** | 自动关闭 → 进入下一步（跳转 / 刷新 / 关闭弹窗等） |
| 失败 | 失败标题 + 具体失败原因 | **5 秒** | 自动关闭（可提前关闭）→ 留在当前页，可重试 |

1. **反馈载体**：按钮操作完成后的结果反馈（成功、失败 + 消息），一律用 Popover 锚定在触发按钮上展示——`PopoverTrigger` 通过 `render` 关联按钮，气泡围绕按钮出现。组件文档：<https://appica.dev/ui/components/react/popover>。
2. **成功**：展示成功反馈，**停留 2 秒**后自动关闭，再进入下一步。停留期间按钮保持禁用，防止重复提交；未满 2 秒不得提前进入下一步。
3. **失败**：展示失败消息（具体、可读的原因），**停留 5 秒**后自动关闭；期间不进入下一步，用户可主动提前关闭失败气泡，按钮保持可点击以便重试。
4. **禁止**：
   - 用 Toast / Message / `alert()` / `confirm()` / 对话框等方式呈现按钮操作反馈
   - 操作失败后静默（无任何反馈）或只 `console.error`
   - 失败只提示「操作失败」，不给具体原因

### 2.2 实现示例

受控用法：`open` 由反馈状态驱动，计时器负责自动关闭；成功回调在停留结束后触发「下一步」。子路径导入，一个组件一个 import。

```tsx
import { useEffect, useRef, useState } from 'react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@appica/ui-react/popover'
import { Button } from '@appica/ui-react/button'

/** 成功反馈停留时长 */
const SUCCESS_STAY_MS = 2_000
/** 失败反馈停留时长 */
const FAILURE_STAY_MS = 5_000

type Feedback =
  | { kind: 'success'; message: string }
  | { kind: 'failure'; message: string }
  | null

export function SaveButton() {
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  // 组件卸载时清理计时器
  useEffect(() => clearTimer, [])

  /** 展示反馈气泡，stayMs 后自动关闭；成功可携带「下一步」回调 */
  const showFeedback = (
    next: NonNullable<Feedback>,
    stayMs: number,
    after?: () => void,
  ) => {
    clearTimer()
    setFeedback(next)
    timerRef.current = setTimeout(() => {
      setFeedback(null)
      after?.()
    }, stayMs)
  }

  const handleSave = async () => {
    if (pending) return
    setPending(true)
    try {
      await save() // 业务请求，如 await api.save()
      // 成功：停留 2 秒后进入下一步（跳转 / 刷新 / 关闭弹窗）
      showFeedback({ kind: 'success', message: '已保存' }, SUCCESS_STAY_MS, () => {
        // navigate('/list') / refresh() / setOpen(false)
      })
    } catch (error) {
      // 失败：展示具体原因，停留 5 秒，留在当前页可重试
      showFeedback(
        {
          kind: 'failure',
          message:
            error instanceof Error ? error.message : '保存失败，请稍后重试',
        },
        FAILURE_STAY_MS,
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Popover
      open={feedback !== null}
      onOpenChange={(open) => {
        // 失败气泡允许用户提前关闭；成功气泡由计时器控制
        if (!open && feedback?.kind === 'failure') {
          clearTimer()
          setFeedback(null)
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            onClick={handleSave}
            disabled={pending || feedback?.kind === 'success'}
          >
            保存
          </Button>
        }
      />
      <PopoverContent side="top" align="center">
        {feedback?.kind === 'success' && (
          <>
            <PopoverTitle>成功</PopoverTitle>
            <PopoverDescription>{feedback.message}</PopoverDescription>
          </>
        )}
        {feedback?.kind === 'failure' && (
          <>
            <PopoverTitle>失败</PopoverTitle>
            <PopoverDescription>{feedback.message}</PopoverDescription>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

### 2.3 实现要点

- **受控 open**：用 `open={feedback !== null}` + `onOpenChange` 驱动，反馈的出现与消失由操作结果和计时器决定，不依赖用户点击开合。
- **计时器管理**：重新触发前先 `clearTimeout` 清旧计时器（防止快速重复点击叠加跳步）；组件卸载时清理。
- **加载态**：请求进行中按钮进入 loading 并禁用，避免重复提交；Popover 只承载「结果」反馈，不承载 loading。
- **定位**：默认 `side="top"`（不遮挡按钮下方内容）；`PopoverContent` 会自动 flip/shift 防止溢出视口，一般无需手动处理。
- **文案**：成功描述写结果（如「已保存」「已发布」）；失败描述写原因与建议动作，直接透出后端/接口的可读错误信息。颜色与图标用组件默认样式或角色 token，禁止手写色值。
- **多按钮**：各按钮独立管理自己的 Popover 反馈，同一按钮同一时刻只有一个反馈气泡。

## 三、规范二：Markdown 编辑器与展示外框一律方角

### 3.1 核心规则

1. **所有 Markdown 编辑器、Markdown 展示区，其外部的框一律不使用圆角，统一方角**（`rounded-none`）。
2. 受约束的「外框」包括：
   - Markdown 编辑器（`MarkdownEditor`，含 `appica` / `compact` 变体）的外层容器
   - Markdown 只读展示（`MarkdownViewer`、`ChatMarkdown`、任务信息、提测内容、缺陷报告等）的外层容器
   - 承载上述组件的包裹框（`Card`、`MarkdownField` 字段框、弹窗正文区、面板等）——只要它在视觉上充当 Markdown 编辑/展示的边框
3. **仅约束外框**：正文内部的代码块、行内代码、引用块、表格、图片等元素保持组件默认样式，不受本条限制。
4. 方角统一写 `rounded-none`；**不得**使用 `rounded-sm/md/lg/xl` 或 `rounded-[var(--radius-*)]`。这属于根 `AGENTS.md`「禁止手写圆角字面量」规则的明确豁免口径——方角是有意设计，不是漏写。

### 3.2 落地改造记录（2026-11-05 已完成）

- 直接外框改 `rounded-none`：`MarkdownField.tsx` 字段框、`TicketCreatePage` 工单字段编辑框、`KnowledgeBrowserPage` 与 `DocumentDetailPage` 编辑器面板、`TaskMarkdownDocumentView` 交付/复盘文档面板
- Markdown 展示框改方角：`TaskRequirementPanel` 需求展示框、`TicketDetailPage` 结构化输入字段框、`TaskConversationView` 用户消息气泡
- 以编辑器为主体的三张卡片改 `rounded-none`：`TaskCreatePage`（任务描述）、`WorkerEditPage`（机器人定义）、`TaskTemplateEditPage`（任务定义描述）
- 明确不动：正文内部元素（行内代码/代码块/图片/表格头，见 `index.css`）、混合内容的信息卡（如任务定义描述卡、缺陷测试报告卡）、提问气泡与思考/工具折叠卡（纯文本内容）、非 Markdown 的圆角小件（头像、徽标、骨架屏等）
- 页面级 Tab 包裹面板（如 `TaskPackageDetailPage` 任务详情正文：白色背景 + 圆角 `rounded-[var(--radius-lg)]` 的外框包裹 Tab 条与各 Tab 面板）属于页面容器，不按「Markdown 外框方角」处理；其内部的 Markdown 编辑/展示面板仍保持方角

## 四、落地检查清单

- [ ] 按钮反馈用 Popover 锚定在触发按钮上，未使用 Toast / `alert()` 等其它形式
- [ ] 成功停留 2 秒后才进入下一步，停留期间按钮禁用、无重复提交
- [ ] 失败展示具体原因，停留 5 秒，可重试、可提前关闭
- [ ] 计时器可正确清理（重复点击、组件卸载）
- [ ] Markdown 编辑器/展示区的最外层容器为方角（`rounded-none`），内部元素样式未受影响

---

## 文件清单

| 文件名 | 路径 | 描述 | 类型 |
|:---|:---|:---|:---|
| `MarkdownEditor.tsx` | [../frontend/src/components/MarkdownEditor.tsx](../frontend/src/components/MarkdownEditor.tsx) | 全站 Markdown 编辑器（Milkdown Crepe），外框须方角 | 组件 |
| `MarkdownViewer.tsx` | [../frontend/src/components/MarkdownViewer.tsx](../frontend/src/components/MarkdownViewer.tsx) | 通用 Markdown 只读渲染，外框须方角 | 组件 |
| `MarkdownField.tsx` | [../frontend/src/components/MarkdownField.tsx](../frontend/src/components/MarkdownField.tsx) | 表单 Markdown 字段封装，外框须方角（现状有圆角待改） | 组件 |
| Popover 文档 | <https://appica.dev/ui/components/react/popover> | Appica UI Popover 组件权威文档 | 外部文档 |

---

**维护人**: Lita R&D Team

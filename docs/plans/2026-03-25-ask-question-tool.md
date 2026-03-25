# Ask Question Tool 实施计划

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** 让 LLM 在 agent loop 执行过程中通过 `ask_question` 工具向用户提问，用户可以在 TUI 中选择选项或输入自定义回答，答案返回给 LLM 继续执行。

**Architecture:** 基于现有 JSON-RPC 2.0 协议扩展。Server 在执行 `ask_question` 工具时暂停（Promise 挂起），向 Client 发送 `ask_question` 通知，Client 渲染选项 UI 并在用户完成后发送 `ask_question_response` 请求，Server 收到后 resolve 挂起的 Promise，工具执行完成，agent loop 继续。

**Tech Stack:** TypeScript, Ink (React for CLI), Zod, JSON-RPC 2.0

**参考实现:** qwen-code 的 `ask_user_question` 工具（`packages/core/src/tools/askUserQuestion.ts`），但我们采用更简洁的直接 JSON-RPC 通知+请求模式，而非 qwen-code 的 permission/confirmation 系统。

---

## 数据流概览

```
LLM 调用 ask_question 工具
    │
    ▼
Agent.executeTool() → askQuestionTool.execute()
    │
    ├─ 1. 调用 sendQuestionToClient(questions)
    │     → Server 发 "ask_question" 通知到 Client
    │
    ├─ 2. await waitForAnswer()
    │     → Promise 挂起，等待 client 回复
    │
    ▼
Client 收到 "ask_question" 通知
    │
    ├─ TUI 渲染 AskQuestionDialog
    │
    ├─ 用户选择选项或输入自定义答案
    │
    ├─ Client 发送 "ask_question_response" 请求
    │
    ▼
Server handleRequest("ask_question_response")
    │
    ├─ resolve 挂起的 Promise，传入 answers
    │
    ▼
askQuestionTool.execute() 继续
    │
    ├─ 格式化答案返回给 LLM
    │
    ▼
Agent loop 继续
```

---

## Task 1: 协议类型定义

**Files:**
- Modify: `src/protocol/types.ts`

**Step 1: 在 `types.ts` 中添加 AskQuestion 相关类型**

在 `DoneNotification` 之后、`ServerNotification` 联合之前添加：

```typescript
// ============ Ask Question 类型 ============

/** 单个选项 */
export interface QuestionOption {
    label: string
    description?: string
}

/** 单个问题 */
export interface Question {
    id: string
    prompt: string
    options: QuestionOption[]
    allowMultiple?: boolean
}

/** ask_question 通知 (server → client) */
export interface AskQuestionNotification extends JsonRpcNotification {
    method: "ask_question"
    params: {
        requestId: string
        questions: Question[]
    }
}

/** ask_question_response 请求参数 (client → server) */
export const AskQuestionResponseParamsSchema = z.object({
    requestId: z.string(),
    answers: z.record(z.string(), z.string()).optional(),
    cancelled: z.boolean().optional(),
})

export type AskQuestionResponseParams = z.infer<typeof AskQuestionResponseParamsSchema>
```

**Step 2: 更新 ServerNotification 联合类型**

```typescript
export type ServerNotification =
    | ContentNotification
    | ReasoningNotification
    | ReasoningEndNotification
    | ToolCallNotification
    | ToolResultNotification
    | DoneNotification
    | AskQuestionNotification  // 新增
```

**Step 3: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过，无错误

**Step 4: Commit**

```bash
git add src/protocol/types.ts
git commit -m "feat: add ask_question protocol types"
```

---

## Task 2: Server 端问答桥接器 (QuestionBridge)

**Files:**
- Create: `src/server/questionBridge.ts`

这是核心组件：在 tool execute 和 server 的 handleRequest 之间建立桥梁。Tool 调用时挂起 Promise，server 收到 client 回复时 resolve。

**Step 1: 创建 questionBridge.ts**

```typescript
import type { Question, AskQuestionResponseParams } from "../protocol/types.js"

export interface AskQuestionRequest {
    requestId: string
    questions: Question[]
}

export interface AskQuestionResult {
    answers?: Record<string, string>
    cancelled: boolean
}

type SendNotificationFn = (method: string, params: unknown) => void

export class QuestionBridge {
    private pending = new Map<string, {
        resolve: (result: AskQuestionResult) => void
        timeoutId?: ReturnType<typeof setTimeout>
    }>()
    private counter = 0
    private sendNotification: SendNotificationFn

    constructor(sendNotification: SendNotificationFn) {
        this.sendNotification = sendNotification
    }

    async ask(questions: Question[], signal?: AbortSignal): Promise<AskQuestionResult> {
        const requestId = `ask_${++this.counter}_${Date.now()}`

        if (signal?.aborted) {
            return { cancelled: true }
        }

        return new Promise<AskQuestionResult>((resolve) => {
            const onAbort = () => {
                this.pending.delete(requestId)
                resolve({ cancelled: true })
            }

            signal?.addEventListener("abort", onAbort, { once: true })

            this.pending.set(requestId, { resolve: (result) => {
                signal?.removeEventListener("abort", onAbort)
                resolve(result)
            }})

            this.sendNotification("ask_question", { requestId, questions })
        })
    }

    handleResponse(params: AskQuestionResponseParams): boolean {
        const entry = this.pending.get(params.requestId)
        if (!entry) return false

        this.pending.delete(params.requestId)
        entry.resolve({
            answers: params.answers,
            cancelled: params.cancelled ?? false,
        })
        return true
    }

    cancelAll(): void {
        for (const [id, entry] of this.pending) {
            entry.resolve({ cancelled: true })
        }
        this.pending.clear()
    }
}
```

**Step 2: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 3: Commit**

```bash
git add src/server/questionBridge.ts
git commit -m "feat: add QuestionBridge for server-client question flow"
```

---

## Task 3: ask_question 工具定义

**Files:**
- Create: `src/server/tools/askQuestion.ts`
- Modify: `src/server/tools/types.ts`

**Step 1: 扩展 ToolContext 添加 askQuestion 能力**

修改 `src/server/tools/types.ts`，在 `ToolContext` 中添加 `askQuestion` 回调：

```typescript
import { z } from "zod"
import type { Question, AskQuestionResult } from "../questionBridge.js"

export interface Tool<T extends z.ZodType = z.ZodType> {
    name: string
    description: string
    parameters: T
    execute: (params: z.infer<T>, ctx: ToolContext) => Promise<string>
}

export interface ToolContext {
    cwd: string
    signal?: AbortSignal
    askQuestion?: (questions: Question[]) => Promise<AskQuestionResult>
}
```

**Step 2: 创建 askQuestion 工具**

创建 `src/server/tools/askQuestion.ts`：

```typescript
import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const AskQuestionParamsSchema = z.object({
    questions: z.array(z.object({
        id: z.string().describe("Unique identifier for this question"),
        prompt: z.string().describe("The question text to display to the user"),
        options: z.array(z.object({
            label: z.string().describe("Display text for this option"),
            description: z.string().optional().describe("Optional description for this option"),
        })).min(2).max(6).describe("Available choices (2-6 options)"),
        allowMultiple: z.boolean().optional().default(false)
            .describe("If true, user can select multiple options"),
    })).min(1).max(4).describe("Questions to ask the user (1-4 questions)"),
})

export const askQuestionTool: Tool<typeof AskQuestionParamsSchema> = {
    name: "ask_question",
    description: `Ask the user a question with selectable options during execution. Use this to:
- Clarify ambiguous instructions
- Get user preferences or decisions
- Offer implementation choices
Each question must have 2-6 options. Users can always provide custom input via "Other".`,
    parameters: AskQuestionParamsSchema,

    async execute(params, ctx: ToolContext): Promise<string> {
        if (!ctx.askQuestion) {
            return "Error: ask_question is not available in this context"
        }

        const result = await ctx.askQuestion(params.questions)

        if (result.cancelled) {
            return "User declined to answer the questions."
        }

        if (!result.answers || Object.keys(result.answers).length === 0) {
            return "User did not provide any answers."
        }

        const formatted = Object.entries(result.answers)
            .map(([questionId, answer]) => {
                const question = params.questions.find(q => q.id === questionId)
                const label = question?.prompt ?? `Question ${questionId}`
                return `**${label}**: ${answer}`
            })
            .join("\n")

        return `User answers:\n\n${formatted}`
    },
}
```

**Step 3: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 4: Commit**

```bash
git add src/server/tools/askQuestion.ts src/server/tools/types.ts
git commit -m "feat: add ask_question tool definition"
```

---

## Task 4: 注册工具 & 集成 Agent

**Files:**
- Modify: `src/server/tools/index.ts`
- Modify: `src/server/agent.ts`
- Modify: `src/server/index.ts`

**Step 1: 在 ToolRegistry 中注册 ask_question 工具**

修改 `src/server/tools/index.ts`，在已有导入后添加：

```typescript
import { askQuestionTool } from "./askQuestion.js"
```

在 `constructor` 中 `this.register(listDirectoryTool)` 之后添加：

```typescript
this.register(askQuestionTool)
```

**Step 2: 修改 Agent 以支持 QuestionBridge**

修改 `src/server/agent.ts`：

2a. 添加导入：

```typescript
import type { QuestionBridge } from "./questionBridge.js"
import type { Question, AskQuestionResult } from "../protocol/types.js"
```

2b. 在 `AgentConfig` 中添加：

```typescript
questionBridge?: QuestionBridge
```

2c. 在 `Agent` 类中保存 bridge：

```typescript
private questionBridge?: QuestionBridge
```

在 constructor 中赋值：

```typescript
this.questionBridge = config.questionBridge
```

2d. 修改 `executeTool` 方法中构建 `ToolContext` 的部分，添加 `askQuestion`：

```typescript
const ctx: ToolContext = {
    cwd: this.cwd,
    signal: this.activeSignal,
    askQuestion: this.questionBridge
        ? (questions: Question[]) => this.questionBridge!.ask(questions, this.activeSignal)
        : undefined,
}
```

**Step 3: 修改 Server 创建 Agent 时注入 QuestionBridge**

修改 `src/server/index.ts`：

3a. 添加导入：

```typescript
import { QuestionBridge } from "./questionBridge.js"
import { AskQuestionResponseParamsSchema } from "../protocol/types.js"
```

3b. 在文件顶部声明 bridge：

```typescript
let questionBridge: QuestionBridge | null = null
```

3c. 在 `case "initialize"` 中，创建 Agent 前创建 bridge：

```typescript
questionBridge = new QuestionBridge(sendNotification)
```

3d. 在 `buildServerAgentConfig` 的返回值中**不加** bridge（因为它不是 config 的一部分），而是在创建 Agent 时传入。修改 `case "initialize"` 和 `case "chat"`（重新创建 Agent 的地方），在 `new Agent(config)` 改为：

```typescript
agent = new Agent({ ...config, questionBridge: questionBridge! })
```

3e. 在 `handleRequest` 的 `switch` 中添加新 case（在 `case "clear"` 之后）：

```typescript
case "ask_question_response": {
    const parseResult = AskQuestionResponseParamsSchema.safeParse(params)
    if (!parseResult.success) {
        sendError(requestId, -32602, "Invalid params")
        return
    }
    if (questionBridge) {
        questionBridge.handleResponse(parseResult.data)
    }
    sendResponse(requestId, {})
    break
}
```

3f. 在 `case "interrupt"` 中也取消挂起的提问：

```typescript
case "interrupt": {
    if (currentAbortController) {
        currentAbortController.abort()
    }
    if (questionBridge) {
        questionBridge.cancelAll()
    }
    sendResponse(requestId, {})
    break
}
```

**Step 4: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 5: Commit**

```bash
git add src/server/tools/index.ts src/server/agent.ts src/server/index.ts
git commit -m "feat: integrate ask_question tool with agent loop and server"
```

---

## Task 5: Client 端支持

**Files:**
- Modify: `src/client/index.ts`

**Step 1: 扩展 ClientEvent 类型**

在 `ClientEvent` 联合类型中添加：

```typescript
| { type: "ask_question"; requestId: string; questions: Array<{
    id: string; prompt: string;
    options: Array<{ label: string; description?: string }>;
    allowMultiple?: boolean
  }> }
```

**Step 2: 在 handleNotification 中添加 ask_question 处理**

在 `case "done"` 之后添加：

```typescript
case "ask_question":
    this.eventHandler({
        type: "ask_question",
        requestId: p.requestId,
        questions: p.questions,
    })
    break
```

**Step 3: 添加 respondToQuestion 方法**

在 `Client` 类中添加公开方法：

```typescript
async respondToQuestion(requestId: string, answers?: Record<string, string>, cancelled?: boolean): Promise<void> {
    await this.sendRequest("ask_question_response", { requestId, answers, cancelled })
}
```

**Step 4: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 5: Commit**

```bash
git add src/client/index.ts
git commit -m "feat: add ask_question support to client"
```

---

## Task 6: TUI AskQuestionDialog 组件

**Files:**
- Create: `src/tui/components/AskQuestionDialog.tsx`

**Step 1: 创建选项选择对话框组件**

```tsx
import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../themes/ThemeContext.js'

interface QuestionOption {
    label: string
    description?: string
}

interface Question {
    id: string
    prompt: string
    options: QuestionOption[]
    allowMultiple?: boolean
}

interface AskQuestionDialogProps {
    questions: Question[]
    onSubmit: (answers: Record<string, string>) => void
    onCancel: () => void
}

export const AskQuestionDialog: React.FC<AskQuestionDialogProps> = ({
    questions,
    onSubmit,
    onCancel,
}) => {
    const { colors } = useTheme()
    const [questionIndex, setQuestionIndex] = useState(0)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())

    const question = questions[questionIndex]
    const isMulti = question.allowMultiple ?? false
    const optionCount = question.options.length

    const submitCurrentQuestion = useCallback((label: string) => {
        const newAnswers = { ...answers, [question.id]: label }
        setAnswers(newAnswers)

        if (questionIndex < questions.length - 1) {
            setQuestionIndex(i => i + 1)
            setSelectedIndex(0)
            setMultiSelected(new Set())
        } else {
            onSubmit(newAnswers)
        }
    }, [answers, question, questionIndex, questions.length, onSubmit])

    const submitMultiSelect = useCallback(() => {
        if (multiSelected.size === 0) return
        const label = Array.from(multiSelected).join(', ')
        submitCurrentQuestion(label)
    }, [multiSelected, submitCurrentQuestion])

    useInput((input, key) => {
        if (key.escape) {
            onCancel()
            return
        }

        if (key.upArrow) {
            setSelectedIndex(i => Math.max(0, i - 1))
            return
        }
        if (key.downArrow) {
            setSelectedIndex(i => Math.min(optionCount - 1, i + 1))
            return
        }

        // Number key quick select
        const num = parseInt(input, 10)
        if (!isNaN(num) && num >= 1 && num <= optionCount) {
            setSelectedIndex(num - 1)
            return
        }

        if (key.return) {
            const option = question.options[selectedIndex]
            if (!option) return

            if (isMulti) {
                submitMultiSelect()
            } else {
                submitCurrentQuestion(option.label)
            }
            return
        }

        // Space to toggle in multi-select
        if (input === ' ' && isMulti) {
            const option = question.options[selectedIndex]
            if (!option) return
            setMultiSelected(prev => {
                const next = new Set(prev)
                if (next.has(option.label)) {
                    next.delete(option.label)
                } else {
                    next.add(option.label)
                }
                return next
            })
            return
        }
    })

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={colors.border.focused} paddingX={1}>
            {/* Progress indicator for multiple questions */}
            {questions.length > 1 && (
                <Box marginBottom={1}>
                    <Text dimColor>
                        Question {questionIndex + 1}/{questions.length}
                    </Text>
                </Box>
            )}

            {/* Question text */}
            <Box marginBottom={1}>
                <Text bold color={colors.border.focused}>? </Text>
                <Text bold>{question.prompt}</Text>
            </Box>

            {/* Options */}
            {question.options.map((opt, idx) => {
                const isSelected = selectedIndex === idx
                const isChecked = isMulti && multiSelected.has(opt.label)
                const highlight = isSelected || isChecked

                return (
                    <Box key={idx} flexDirection="column">
                        <Box>
                            <Text
                                color={highlight ? colors.border.focused : undefined}
                                bold={highlight}
                            >
                                {isSelected ? '❯ ' : '  '}
                                {isMulti ? (isChecked ? '[✓] ' : '[ ] ') : ''}
                                {idx + 1}. {opt.label}
                            </Text>
                        </Box>
                        {opt.description && (
                            <Box marginLeft={isMulti ? 8 : 4}>
                                <Text dimColor>{opt.description}</Text>
                            </Box>
                        )}
                    </Box>
                )
            })}

            {/* Help text */}
            <Box marginTop={1}>
                <Text dimColor>
                    {isMulti
                        ? '↑/↓: Navigate | Space: Toggle | Enter: Confirm | Esc: Cancel'
                        : '↑/↓: Navigate | Enter: Select | Esc: Cancel'
                    }
                </Text>
            </Box>
        </Box>
    )
}
```

**Step 2: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 3: Commit**

```bash
git add src/tui/components/AskQuestionDialog.tsx
git commit -m "feat: add AskQuestionDialog TUI component"
```

---

## Task 7: TUI App 集成

**Files:**
- Modify: `src/tui/App.tsx`

**Step 1: 添加导入**

```typescript
import { AskQuestionDialog } from './components/AskQuestionDialog.js'
```

**Step 2: 添加状态管理**

在 `streaming` state 之后添加：

```typescript
const [pendingQuestion, setPendingQuestion] = useState<{
    requestId: string
    questions: Array<{
        id: string; prompt: string;
        options: Array<{ label: string; description?: string }>;
        allowMultiple?: boolean
    }>
} | null>(null)
```

**Step 3: 在 handleEvent 中添加 ask_question 事件处理**

在 `case 'done'` 之后添加：

```typescript
case 'ask_question':
    setPendingQuestion({
        requestId: event.requestId,
        questions: event.questions,
    })
    break
```

**Step 4: 添加回答处理函数**

在 `handleInterrupt` 之后添加：

```typescript
const handleQuestionSubmit = useCallback(async (answers: Record<string, string>) => {
    if (!client || !pendingQuestion) return
    await client.respondToQuestion(pendingQuestion.requestId, answers)
    setPendingQuestion(null)
}, [client, pendingQuestion])

const handleQuestionCancel = useCallback(async () => {
    if (!client || !pendingQuestion) return
    await client.respondToQuestion(pendingQuestion.requestId, undefined, true)
    setPendingQuestion(null)
}, [client, pendingQuestion])
```

**Step 5: 在 JSX 中渲染对话框**

在 `{isLoading && (...)}` 和 `<InputBox>` 之间添加：

```tsx
{pendingQuestion && (
    <AskQuestionDialog
        questions={pendingQuestion.questions}
        onSubmit={handleQuestionSubmit}
        onCancel={handleQuestionCancel}
    />
)}
```

同时修改 `<InputBox>` 的 `disabled` prop，在有 pendingQuestion 时也禁用输入：

```tsx
<InputBox
    onSubmit={handleSubmit}
    onClear={handleClear}
    onInterrupt={handleInterrupt}
    disabled={isLoading || !isReady || pendingQuestion !== null}
    commands={registry.getVisibleCommands()}
/>
```

**Step 6: 确认无编译错误**

Run: `npx tsc --noEmit`
Expected: 编译通过

**Step 7: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat: integrate AskQuestionDialog into TUI App"
```

---

## Task 8: 构建 & 手动测试

**Step 1: 构建项目**

Run: `npm run build`
Expected: 编译成功，无错误

**Step 2: 手动冒烟测试**

Run: `npm run dev`

在 TUI 中输入如下消息来触发 ask_question 工具：

```
Please ask me what programming language I prefer. Give me options: Python, JavaScript, Go, Rust.
```

Expected:
1. LLM 应该调用 `ask_question` 工具
2. TUI 中出现带选项的对话框
3. 可以用上下箭头选择选项
4. Enter 确认后，LLM 收到答案并继续对话

**Step 3: 测试取消功能**

再次触发提问，这次按 Esc 取消。

Expected: LLM 收到 "User declined to answer" 消息

**Step 4: 测试 interrupt**

触发提问后，按 Ctrl+C (interrupt)。

Expected: 提问被取消，agent loop 中断

**Step 5: Commit (如果有修复)**

```bash
git add -A
git commit -m "fix: address issues found in manual testing"
```

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| Modify | `src/protocol/types.ts` | 添加 Question/AskQuestion 相关类型 |
| Create | `src/server/questionBridge.ts` | Server 端 Promise 桥接器 |
| Create | `src/server/tools/askQuestion.ts` | ask_question 工具定义 |
| Modify | `src/server/tools/types.ts` | ToolContext 添加 askQuestion 回调 |
| Modify | `src/server/tools/index.ts` | 注册 ask_question 工具 |
| Modify | `src/server/agent.ts` | Agent 支持 QuestionBridge |
| Modify | `src/server/index.ts` | Server 处理 ask_question_response |
| Modify | `src/client/index.ts` | Client 支持 ask_question 事件 |
| Create | `src/tui/components/AskQuestionDialog.tsx` | TUI 选项对话框组件 |
| Modify | `src/tui/App.tsx` | 集成 AskQuestionDialog |

---

## 未来扩展（不在本次范围内）

1. **自定义输入 (Other)**: 允许用户在选项外输入自由文本，类似 qwen-code 的 "Type something..." 功能
2. **多问题 Tab 切换**: 多个问题时用左右箭头切换 tab，类似 qwen-code 的 tab 导航
3. **Subagent 中的 askQuestion**: 让子 agent 也能向用户提问（需要穿透 delegation 层）
4. **超时机制**: 用户长时间不回答时自动取消

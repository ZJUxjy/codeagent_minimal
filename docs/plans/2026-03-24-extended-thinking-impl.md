# Extended Thinking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Claude extended thinking support with dual-track display (history + loading indicator).

**Architecture:** Minimal invasive approach - add reasoning event type to protocol, create independent ThinkingMessage component, apply safe split algorithm for Markdown integrity.

**Tech Stack:** Vercel AI SDK, Ink (React TUI), TypeScript, JSON-RPC 2.0

---

## Task 1: Protocol Types

**Files:**
- Modify: `src/protocol/types.ts`

**Step 1: Add ReasoningNotification types**

Add after `ContentNotification` interface (around line 60):

```typescript
/** 思考内容通知 */
export interface ReasoningNotification extends JsonRpcNotification {
    method: "reasoning"
    params: {
        delta: string
    }
}

/** 思考内容结束通知 */
export interface ReasoningEndNotification extends JsonRpcNotification {
    method: "reasoning_end"
    params: {}
}
```

**Step 2: Update ServerNotification union**

Modify the `ServerNotification` type (around line 90):

```typescript
/** 所有通知类型的联合 */
export type ServerNotification =
    | ContentNotification
    | ReasoningNotification
    | ReasoningEndNotification
    | ToolCallNotification
    | ToolResultNotification
    | DoneNotification
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/protocol/types.ts
git commit -m "feat(protocol): add reasoning notification types"
```

---

## Task 2: TUI Message Types

**Files:**
- Modify: `src/tui/types.ts`

**Step 1: Add ThinkingMessage type**

Add after `ToolMessage` interface (around line 31):

```typescript
export interface ThinkingMessage extends BaseMessage {
    role: "thinking"
    content: string
    isStreaming?: boolean
}
```

**Step 2: Update Message union**

Modify the `Message` type:

```typescript
export type Message = UserMessage | AssistantMessage | ToolMessage | ThinkingMessage;
```

**Step 3: Update AppState**

Add `thinkingContent` and `thoughtSubject` to `AppState`:

```typescript
export interface AppState {
    messages: Message[];
    isLoading: boolean;
    loadingText?: string;
    thinkingContent?: string;      // 新增：当前累积的思考内容
    thoughtSubject?: string;       // 新增：思考主题（用于加载栏）
    isThinkingStreaming?: boolean; // 新增：思考是否正在流式输出

    inputValue: string;
    inputHistory: string[];
    historyIndex: number;

    model: string;
    provider: string;
    cwd: string;
}
```

**Step 4: Update AppActions**

Add thinking-related actions to `AppActions`:

```typescript
export interface AppActions {
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
    updateMessage: (id: string, update: Partial<Message>) => void;

    setInputValue: (value: string) => void;
    submitInput: () => void;

    navigateHistory: (direction: 'up' | 'down') => void;

    clearMessages: () => void;
    setLoading: (loading: boolean, text?: string) => void;

    // 新增：思考内容操作
    appendThinking: (delta: string) => void;
    finalizeThinking: () => void;
    clearThinking: () => void;
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors (may have unused variable warnings)

**Step 6: Commit**

```bash
git add src/tui/types.ts
git commit -m "feat(tui): add ThinkingMessage type and thinking state"
```

---

## Task 3: Safe Split Algorithm

**Files:**
- Create: `src/utils/markdownSplit.ts`

**Step 1: Create the utility file**

```typescript
/**
 * Markdown 安全分割工具
 * 用于在流式输出时找到安全的分割点，避免破坏 Markdown 结构
 */

/**
 * 找到包含指定位置的代码块的起始位置
 * @param content 内容字符串
 * @param position 要检查的位置
 * @returns 如果在代码块内，返回代码块起始位置；否则返回 -1
 */
export const findEnclosingCodeBlockStart = (
    content: string,
    position: number,
): number => {
    let inCodeBlock = false
    let codeBlockStart = -1
    let i = 0

    while (i < position) {
        if (content.slice(i, i + 3) === "```") {
            if (!inCodeBlock) {
                codeBlockStart = i
            }
            inCodeBlock = !inCodeBlock
            // 跳过整个 ``` 标记
            i += 3
            // 跳过可能的语言标识符行
            while (i < position && content[i] !== "\n") {
                i++
            }
            continue
        }
        i++
    }

    return inCodeBlock ? codeBlockStart : -1
}

/**
 * 找到最后一个安全分割点
 * 优先级：代码块边界 > 双换行 > 单换行 > 不分割
 *
 * @param content 要分割的内容
 * @returns 安全分割点的位置（可以在该位置切分）
 */
export const findLastSafeSplitPoint = (content: string): number => {
    if (content.length === 0) {
        return 0
    }

    // 1. 检查末尾是否在代码块内
    const codeBlockStart = findEnclosingCodeBlockStart(content, content.length)
    if (codeBlockStart !== -1) {
        // 在代码块内，在代码块开始处切分
        return codeBlockStart
    }

    // 2. 查找最后一个双换行（不在代码块内）
    let lastDoubleNewline = -1
    let inCodeBlock = false
    let i = 0

    while (i < content.length - 1) {
        if (content.slice(i, i + 3) === "```") {
            inCodeBlock = !inCodeBlock
            i += 3
            continue
        }
        if (!inCodeBlock && content.slice(i, i + 2) === "\n\n") {
            lastDoubleNewline = i
        }
        i++
    }

    if (lastDoubleNewline !== -1) {
        return lastDoubleNewline + 2 // 返回双换行后的位置
    }

    // 3. 查找最后一个单换行（不在代码块内）
    inCodeBlock = false
    i = 0
    let lastNewline = -1

    while (i < content.length) {
        if (content.slice(i, i + 3) === "```") {
            inCodeBlock = !inCodeBlock
            i += 3
            continue
        }
        if (!inCodeBlock && content[i] === "\n") {
            lastNewline = i
        }
        i++
    }

    if (lastNewline !== -1) {
        return lastNewline + 1
    }

    // 4. 没有安全分割点，不分割
    return content.length
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/utils/markdownSplit.ts
git commit -m "feat(utils): add markdown safe split algorithm"
```

---

## Task 4: LLM Client - StreamEvent Type

**Files:**
- Modify: `src/llm.ts`

**Step 1: Update StreamEvent type**

Modify the `StreamEvent` type (around line 18):

```typescript
export type StreamEvent =
    | { type: "content"; delta: string }
    | { type: "reasoning"; delta: string }  // 新增
    | { type: "reasoning_end" }              // 新增
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "done"; finishReason: string }
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat(llm): add reasoning event types to StreamEvent"
```

---

## Task 5: LLM Client - Extended Thinking Config

**Files:**
- Modify: `src/llm.ts`

**Step 1: Add extended thinking configuration**

In the `stream` method, modify the `streamText` call (around line 94):

```typescript
const result = streamText({
    model,
    messages,
    tools: toolDefs,
    maxSteps: 10,
    // 新增：Anthropic extended thinking 配置
    ...(this.config.provider === "anthropic" && {
        providerOptions: {
            anthropic: {
                thinking: { type: "enabled", budgetTokens: 16000 },
            },
        },
        headers: {
            "anthropic-beta": "interleaved-thinking-2025-05-14",
        },
    }),
})
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat(llm): enable extended thinking for Anthropic provider"
```

---

## Task 6: LLM Client - Handle Reasoning Chunks

**Files:**
- Modify: `src/llm.ts`

**Step 1: Add reasoning chunk handling**

In the `for await (const chunk of result.fullStream)` loop (around line 102), add reasoning handling:

```typescript
for await (const chunk of result.fullStream) {
    this.log(`Chunk type: ${chunk.type}`)

    if (chunk.type === "text-delta") {
        // 文本增量
        yield { type: "content", delta: chunk.textDelta }
    } else if (chunk.type === "reasoning") {
        // 新增：思考内容增量
        yield { type: "reasoning", delta: chunk.text }
    } else if (chunk.type === "reasoning-part-finish") {
        // 新增：思考块结束
        yield { type: "reasoning_end" }
    } else if (chunk.type === "tool-call") {
        yield {
            type: "tool_call",
            id: chunk.toolCallId,
            name: chunk.toolName,
            args: chunk.args as Record<string, unknown>,
        }
    } else if (chunk.type === "error") {
        // API 错误
        this.log(`API Error:`, chunk.error)
        yield { type: "done", finishReason: `error: ${chunk.error}` }
        return
    }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat(llm): handle reasoning chunks in stream"
```

---

## Task 7: Agent - AgentEvent Type

**Files:**
- Modify: `src/server/agent.ts`

**Step 1: Update AgentEvent type**

Modify the `AgentEvent` type (around line 22):

```typescript
/** Agent 输出事件 */
export type AgentEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }   // 新增
  | { type: "reasoning_end" }               // 新增
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "done"; finishReason: string }
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): add reasoning event types to AgentEvent"
```

---

## Task 8: Agent - Forward Reasoning Events

**Files:**
- Modify: `src/server/agent.ts`

**Step 1: Add reasoning event forwarding**

In the `run` method's `for await (const event of stream)` loop (around line 70), add reasoning handling:

```typescript
for await (const event of stream) {
    if (event.type === "content") {
        // 文本增量
        assistantContent += event.delta
        yield { type: "content", delta: event.delta }

    } else if (event.type === "reasoning") {
        // 新增：思考内容增量 - 直接转发
        yield { type: "reasoning", delta: event.delta }

    } else if (event.type === "reasoning_end") {
        // 新增：思考块结束
        yield { type: "reasoning_end" }

    } else if (event.type === "tool_call") {
        // 工具调用
        yield { type: "tool_call", id: event.id, name: event.name, args: event.args }

        // 执行工具
        const result = await this.executeTool(event)
        yield { type: "tool_result", id: event.id, content: result.content, isError: result.isError }

    } else if (event.type === "done") {
        // 保存 assistant 消息
        if (assistantContent) {
            this.store.add({ role: "assistant", content: assistantContent })
        }

        yield { type: "done", finishReason: event.finishReason }
    }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat(agent): forward reasoning events from LLM stream"
```

---

## Task 9: Client - Handle Reasoning Notifications

**Files:**
- Modify: `src/client/client.ts`

**Step 1: Read current client implementation**

First, examine the current client to understand the notification handling pattern.

**Step 2: Add reasoning notification handlers**

In the notification handling section, add handlers for `reasoning` and `reasoning_end`:

```typescript
// 在 handleNotification 或类似方法中添加
case "reasoning":
    // 累积思考内容
    this.onReasoning?.(params.delta)
    break

case "reasoning_end":
    // 思考块结束
    this.onReasoningEnd?.()
    break
```

**Step 3: Add callback types to client interface**

Add to the client's callback interface:

```typescript
interface ClientCallbacks {
    // ... existing callbacks
    onReasoning?: (delta: string) => void
    onReasoningEnd?: () => void
}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/client/client.ts
git commit -m "feat(client): handle reasoning notifications from server"
```

---

## Task 10: ThinkingMessage Component

**Files:**
- Create: `src/tui/components/ThinkingMessage.tsx`

**Step 1: Create the component**

```typescript
import React, { useState, useEffect } from "react"
import { Box, Text } from "ink"
import type { SemanticColors } from "../themes/types.js"

interface ThinkingMessageProps {
    content: string
    colors: SemanticColors
    isStreaming?: boolean
}

export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({
    content,
    colors,
    isStreaming = false,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true)

    // 流式输出时自动展开
    useEffect(() => {
        if (isStreaming) {
            setIsCollapsed(false)
        }
    }, [isStreaming])

    // 流式输出完成后自动折叠
    useEffect(() => {
        if (!isStreaming && content.length > 0) {
            // 延迟折叠，让用户有时间看到内容
            const timer = setTimeout(() => {
                setIsCollapsed(true)
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [isStreaming, content.length])

    const prefix = isStreaming ? "✦ " : "✓ "
    const statusText = isStreaming ? "Thinking..." : "Thought"

    if (isCollapsed) {
        // 折叠状态：只显示摘要
        const preview = content.length > 50 ? content.slice(0, 50) + "..." : content
        return (
            <Box flexDirection="row">
                <Text dimColor color={colors.text.secondary}>
                    {prefix}[{statusText}] {preview}
                </Text>
            </Box>
        )
    }

    // 展开状态：显示完整内容
    return (
        <Box
            flexDirection="column"
            borderLeft
            borderStyle="single"
            borderColor={colors.border.default}
            paddingLeft={1}
            marginBottom={1}
        >
            <Text dimColor color={colors.text.secondary}>
                {prefix}{statusText}:
            </Text>
            <Box flexDirection="column" marginLeft={1}>
                {content.split("\n").map((line, i) => (
                    <Text key={i} dimColor color={colors.text.secondary}>
                        {line}
                    </Text>
                ))}
            </Box>
        </Box>
    )
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/components/ThinkingMessage.tsx
git commit -m "feat(tui): add ThinkingMessage component"
```

---

## Task 11: LoadingIndicator Extension

**Files:**
- Modify: `src/tui/components/LoadingIndicator.tsx`

**Step 1: Add thoughtSubject prop**

```typescript
import React from "react"
import { Text } from "ink"
import Spinner from "ink-spinner"
import { useTheme } from "../themes/ThemeContext.js"

interface LoadingIndicatorProps {
    text?: string
    thoughtSubject?: string  // 新增：思考主题
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
    text = "Thinking...",
    thoughtSubject,
}) => {
    const { colors } = useTheme()

    // 优先显示思考主题
    const displayText = thoughtSubject || text

    return (
        <Text color={colors.text.secondary}>
            <Spinner type="dots12" /> {displayText}
        </Text>
    )
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/tui/components/LoadingIndicator.tsx
git commit -m "feat(tui): add thoughtSubject support to LoadingIndicator"
```

---

## Task 12: MessageItem - Render Thinking Messages

**Files:**
- Modify: `src/tui/components/MessageItem.tsx`

**Step 1: Import ThinkingMessage**

Add to imports:

```typescript
import { ThinkingMessage } from "./ThinkingMessage.js"
```

**Step 2: Add thinking message rendering**

Add a new case in the message rendering logic (after the tool message case):

```typescript
} else if (message.role === "thinking") {
    return (
        <Box marginTop={0}>
            <ThinkingMessage
                content={message.content}
                colors={colors}
                isStreaming={message.isStreaming}
            />
        </Box>
    )
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/tui/components/MessageItem.tsx
git commit -m "feat(tui): render ThinkingMessage in MessageItem"
```

---

## Task 13: App - Wire Thinking State

**Files:**
- Modify: `src/tui/App.tsx` (or main TUI component)

**Step 1: Add thinking state management**

Add state for thinking content:

```typescript
const [thinkingContent, setThinkingContent] = useState("")
const [isThinkingStreaming, setIsThinkingStreaming] = useState(false)
```

**Step 2: Add thinking action handlers**

```typescript
const appendThinking = (delta: string) => {
    setIsThinkingStreaming(true)
    setThinkingContent(prev => prev + delta)
}

const finalizeThinking = () => {
    setIsThinkingStreaming(false)
    // 将累积的思考内容添加为消息
    if (thinkingContent) {
        addMessage({
            role: "thinking",
            content: thinkingContent,
            isStreaming: false,
        })
        setThinkingContent("")
    }
}

const clearThinking = () => {
    setThinkingContent("")
    setIsThinkingStreaming(false)
}
```

**Step 3: Connect to client callbacks**

Wire the handlers to the client's reasoning callbacks.

**Step 4: Pass thoughtSubject to LoadingIndicator**

```typescript
<LoadingIndicator
    thoughtSubject={isThinkingStreaming ? "Analyzing..." : undefined}
/>
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat(tui): wire thinking state management in App"
```

---

## Task 14: Integration Test

**Step 1: Build the project**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Run with Anthropic provider**

Run: `npm run dev`
Then configure with Anthropic and test with a complex question.

**Step 3: Verify thinking content appears**

Expected behavior:
- Thinking content shows with `✦` prefix during streaming
- Content collapses after streaming ends
- Loading indicator shows "Analyzing..." during thinking

**Step 4: Test with other providers**

Run: `npm run dev`
Configure with OpenAI and verify it works normally (no thinking content).

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete extended thinking implementation"
```

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | protocol/types.ts | Add reasoning notification types |
| 2 | tui/types.ts | Add ThinkingMessage type |
| 3 | utils/markdownSplit.ts | Safe split algorithm |
| 4 | llm.ts | Add StreamEvent types |
| 5 | llm.ts | Enable extended thinking |
| 6 | llm.ts | Handle reasoning chunks |
| 7 | agent.ts | Add AgentEvent types |
| 8 | agent.ts | Forward reasoning events |
| 9 | client/client.ts | Handle reasoning notifications |
| 10 | ThinkingMessage.tsx | Thinking message component |
| 11 | LoadingIndicator.tsx | Add thoughtSubject support |
| 12 | MessageItem.tsx | Render thinking messages |
| 13 | App.tsx | Wire thinking state |
| 14 | - | Integration test |

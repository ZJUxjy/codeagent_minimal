# Bug 记录

## BUG-001: Agent Loop 消息顺序与格式导致多轮工具调用失败

**日期:** 2026-03-25

**现象:** LLM 在第一轮调用工具后无法进入第二轮，agent loop 在第一次 tool call 后就停止。TUI 显示工具执行结果后不再继续生成内容。

**错误信息（按修复阶段）:**

1. 第一次报错：`finishReason: "error: Unsupported role: tool"`
2. 修复消息顺序后第二次报错：`finishReason: "error: ToolInvocation must have a result: {\"toolCallId\":...}"`

**根因分析:**

问题出在 `src/server/agent.ts` 的 `runLoop` 方法中，存在两个独立的 bug：

### Bug 1: Store 中消息顺序错误

原代码在 streaming loop **内部**执行工具并将 tool result 存入 store，但 assistant 消息（含 tool call 信息）直到 loop **结束后**才存入。

```
原始执行顺序:
  stream → tool_call_1 → executeTool → store.add(role:"tool") → tool_call_2 → executeTool → store.add(role:"tool") → stream end → store.add(role:"assistant")

Store 中的消息顺序:
  [user, tool_result_1, tool_result_2, assistant_with_tool_calls]  ← 错误！

正确顺序应为:
  [user, assistant_with_tool_calls, tool_result_1, tool_result_2]
```

LLM API（minimax 等）要求 `tool` 消息必须紧跟在包含对应 tool call 的 `assistant` 消息之后。当 `tool` 消息出现在 `assistant` 之前时，API 报 `"Unsupported role: tool"`。

### Bug 2: Assistant 消息使用了错误的字段格式

原代码使用 `toolInvocations` 字段（这是 Vercel AI SDK UI 层 `UIMessage` 的概念）：

```typescript
// 错误写法
store.add({
    role: "assistant",
    content: assistantContent,
    toolInvocations: toolCalls,  // UIMessage 字段，不是 CoreMessage
} as CoreMessage)
```

`toolInvocations` 要求每个 invocation 都有 `result` 字段。而 `CoreMessage` 格式应该用 `content` 数组，包含 `TextPart` 和 `ToolCallPart`：

```typescript
// 正确写法
store.add({
    role: "assistant",
    content: [
        { type: "text", text: assistantContent },
        { type: "tool-call", toolCallId: "...", toolName: "...", args: {...} },
    ],
} as CoreMessage)
```

Tool results 则作为独立的 `role: "tool"` 消息存储。

**修复方案:**

将 `runLoop` 拆分为三个阶段：

1. **Phase 1 — 收集**：消费流式事件，累积 content 和 tool calls，不执行工具
2. **Phase 2 — 持久化 assistant**：stream 结束后，先将 assistant 消息（含所有 tool-call parts）存入 store
3. **Phase 3 — 执行工具**：依次执行每个 tool call，将 tool result 作为独立 `role: "tool"` 消息存入 store

同时将 `persistAssistantStep` 改为使用正确的 `CoreMessage` 格式：当有 tool calls 时，`content` 为 `Array<TextPart | ToolCallPart>`。

**涉及文件:**

- `src/server/agent.ts`

**影响范围:**

所有使用工具调用的场景。此 bug 导致任何需要多轮工具调用才能完成的任务都会在第一轮后中断。

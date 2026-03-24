# Extended Thinking 设计文档

## 概述

为 lop_minimal 添加 Claude Extended Thinking 支持，实现模型思考内容的可视化展示。

## 目标

1. 在对话历史区渲染思考内容（折叠/展开）
2. 在底部加载栏实时显示思考主题
3. 安全分割长思考内容，防止 Markdown 截断
4. 兼容其他 provider（OpenAI/Gemini/MiniMax）

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│                         LLM (Claude)                          │
│                    reasoning + content stream                 │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      LLMClient (llm.ts)                       │
│  - 识别 reasoning chunk                                       │
│  - 应用 findLastSafeSplitPoint                                │
│  - 输出 StreamEvent (新增 reasoning 类型)                     │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      Agent (agent.ts)                         │
│  - 转发 reasoning 事件                                        │
│  - 累积 thinkingBuffer                                       │
└───────────────────────────┬──────────────────────────────────┘
                            │ JSON-RPC
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                   Protocol (types.ts)                         │
│  - 新增 ReasoningNotification                                │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                        TUI (Client)                           │
│  ┌─────────────────┐    ┌─────────────────┐                  │
│  │ ThinkingMessage │    │ LoadingIndicator│                  │
│  │ (折叠/展开)      │    │ (思考主题)       │                  │
│  └─────────────────┘    └─────────────────┘                  │
└──────────────────────────────────────────────────────────────┘
```

## 类型定义

### StreamEvent 扩展 (src/llm.ts)

```typescript
export type StreamEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }  // 新增
  | { type: "reasoning_end" }              // 新增
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "done"; finishReason: string }
```

### AgentEvent 扩展 (src/server/agent.ts)

```typescript
export type AgentEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }   // 新增
  | { type: "reasoning_end" }               // 新增
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "done"; finishReason: string }
```

### Protocol Notification (src/protocol/types.ts)

```typescript
export interface ReasoningNotification extends JsonRpcNotification {
    method: "reasoning"
    params: { delta: string }
}

export interface ReasoningEndNotification extends JsonRpcNotification {
    method: "reasoning_end"
    params: {}
}

export type ServerNotification =
  | ContentNotification
  | ReasoningNotification
  | ReasoningEndNotification
  | ToolCallNotification
  | ToolResultNotification
  | DoneNotification
```

### TUI Message 类型 (src/tui/types.ts)

```typescript
export interface ThinkingMessage extends BaseMessage {
    role: "thinking"
    content: string
    isCollapsed: boolean
    isStreaming?: boolean
}

export type Message = UserMessage | AssistantMessage | ToolMessage | ThinkingMessage
```

## LLM 客户端改动

### 启用 Extended Thinking

```typescript
const result = streamText({
    model,
    messages,
    tools: toolDefs,
    maxSteps: 10,
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

### 处理 reasoning chunk

```typescript
for await (const chunk of result.fullStream) {
    if (chunk.type === "text-delta") {
        yield { type: "content", delta: chunk.textDelta }
    } else if (chunk.type === "reasoning") {
        yield { type: "reasoning", delta: chunk.text }
    } else if (chunk.type === "reasoning-part-finish") {
        yield { type: "reasoning_end" }
    }
    // ...
}
```

## 安全分割算法

### findLastSafeSplitPoint (src/utils/markdownSplit.ts)

优先级：代码块边界 > 双换行 > 单换行 > 不分割

```typescript
export const findLastSafeSplitPoint = (content: string): number => {
    // 1. 检查是否在代码块内 -> 返回代码块开始位置
    // 2. 查找最后一个双换行（不在代码块内）
    // 3. 查找最后一个单换行
    // 4. 返回 content.length（不分割）
}
```

## TUI 组件

### ThinkingMessage

- 默认折叠，显示 "[Thought] (press Enter to expand)"
- 流式输出时自动展开
- 完成后自动折叠
- 使用 `colors.text.secondary` 视觉降权

### LoadingIndicator 扩展

- 新增 `thoughtSubject` 参数
- 优先显示思考主题而非通用加载文本

## 文件清单

### 新建文件

| 文件 | 用途 |
|------|------|
| `src/utils/markdownSplit.ts` | 安全分割算法 |
| `src/tui/components/ThinkingMessage.tsx` | 思考内容渲染 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `src/llm.ts` | reasoning 事件，extended thinking |
| `src/server/agent.ts` | 转发 reasoning 事件 |
| `src/protocol/types.ts` | ReasoningNotification |
| `src/tui/types.ts` | ThinkingMessage |
| `src/tui/components/LoadingIndicator.tsx` | thoughtSubject |
| `src/tui/components/MessageItem.tsx` | 渲染 thinking |
| `src/client/client.ts` | 处理 reasoning 通知 |

## 实现顺序

1. 类型定义 (protocol/types.ts, tui/types.ts)
2. 工具函数 (utils/markdownSplit.ts)
3. LLM 客户端 (llm.ts)
4. 服务端 (server/agent.ts)
5. 客户端 (client/client.ts)
6. TUI 组件 (ThinkingMessage, LoadingIndicator, MessageItem)

## 测试要点

1. 兼容性：OpenAI/Gemini/MiniMax 正常工作
2. Markdown 完整性：分割不破坏代码块
3. 折叠/展开：交互逻辑正确
4. 流式输出：实时渲染效果

## 参考

- [Vercel AI SDK - Claude 4 Guide](https://ai-sdk.dev/cookbook/guides/claude-4)
- [Vercel AI SDK - streamText API](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text)

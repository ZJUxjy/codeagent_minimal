# Agent 上下文与架构修复实施计划

> **执行者:** 需要使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 技能。 任务使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 修复阻止多轮工具执行的关键问题，提升代码库架构一致性。

**架构:** 统一类型定义。 修复工具结果注入到 LLM 上下文。 隔离日志通道. 添加安全钩子框架. 抽取 TUI 状态管理.

**技术栈:** TypeScript, Vercel AI SDK, Zod, React/Ink

---

## 任务结构

### 任务 1: 修复工具结果注入 (P0 - 关键)

**问题:** 工具执行结果作为事件 yield 出去，但从未存回消息历史。LLM 无法在后续轮次看到工具结果。

**分析:**
- `src/llm.ts:102` 已配置 `maxSteps: 10`
- AI SDK 的 `streamText` 可以在内部处理多步工具执行
- 但是 `agent.run()` yield 事件却没有将工具结果持久化到 `MessageStore`
- Vercel AI SDK 的 `CoreMessage` 类型通过 `role: "tool"` 支持工具消息

**关键决策: 使用 AI SDK 内置的多步处理**

**文件:**
- 修改: `src/server/agent.ts`
- 修改: `src/server/store.ts`

**实现:**

**方案 A (推荐):** 让 AI SDK 处理多步，为历史记录存储工具结果。

`CoreMessage` 类型支持:
```typescript
// 带工具调用的助手消息
{ role: "assistant", content: string, toolInvocations?: ToolInvocation[] }

// 工具结果消息
{ role: "tool", toolCallId: string, content: string }
```

**`run()` 方法的改动:**

```typescript
// 在 src/server/agent.ts

// 跟踪本轮的工具调用
const toolCallsThisTurn: Array<{toolCallId: string; toolName: string; args: Record<string, unknown>}> = []

// 在 tool_call 处理中:
toolCallsThisTurn.push({
  toolCallId: event.id,
  toolName: event.name,
  args: event.args
})
yield { type: "tool_call", ... }

// 在 executeTool 之后，存储工具结果:
this.store.add({
  role: "tool",
  toolCallId: event.id,
  content: result.content,
})
yield { type: "tool_result", ... }

// 在 done 处理中，存储带工具调用的助手消息:
if (assistantContent || toolCallsThisTurn.length > 0) {
  this.store.add({
    role: "assistant",
    content: assistantContent,
    toolInvocations: toolCallsThisTurn.length > 0 ? toolCallsThisTurn : undefined,
  } as CoreMessage)
}
```

**测试:**
- 创建测试文件: `src/server/__tests__/agent-tool-context.test.ts`
- 测试: 工具结果存入消息历史
- 测试: 助手消息包含 toolInvocations
- 测试: 多轮对话包含工具结果
- 测试: LLM 通过 `store.getAll()` 在后续调用中收到工具结果

**验证:**
```bash
npm run build
npm test -- --grep "agent-tool-context"
```

---

### 任务 2: 修复 stdout 污染 (P1 - 高)

**问题:** `src/config.ts` 使用 `console.log()` 污染 stdout。服务进程使用 stdout 进行 JSON-RPC 通信，这会破坏协议通信。

**文件:**
- 修改: `src/config.ts`

**实现:**

修改第 43 行和类似的日志语句:

```typescript
// 修改前 (第 43 行):
console.log(`Loaded config from ${path}`)

// 修改后:
console.error(`[Config] Loaded config from ${path}`)
```

同时检查第 62 行 homedir 加载 - 同样的修复。

**替代方案 - 使用 debugLog:**
```typescript
import { debugLog } from "./config.js" // 自导入以保持一致

// 或创建专用日志函数:
function configLog(...args: unknown[]): void {
  console.error("[Config]", ...args)
}
```

**测试:**
- 手动测试: 运行服务模式，验证 stdout 只包含 JSON-RPC
- 测试: `npm run build && node dist/server/index.js` - 发送输入，检查输出是有效 JSON

**验证:**
```bash
npm run build
# 手动验证 - stdout 应该只包含 JSON
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node dist/server/index.js 2>/dev/null
```

---

### 任务 3: 统一 Provider 类型 (P2 - 中等)

**问题:** Provider 类型在两处定义，值不同:
- `src/llm.ts:8` 有 `"google"`
- `src/server/agent.ts:12` 缺少 `"google"`
- `src/protocol/types.ts:113` (LopConfig.provider) 也缺少 `"google"`

**文件:**
- 修改: `src/protocol/types.ts` (添加 Provider 类型，更新 LopConfig)
- 修改: `src/llm.ts` (导入 Provider)
- 修改: `src/server/agent.ts` (导入 Provider)

**实现:**

1. 在 `src/protocol/types.ts` 添加:
```typescript
// 在文件顶部 import 之后添加
export type Provider = "openai" | "anthropic" | "openrouter" | "minimax" | "google"
```

2. 更新 `src/protocol/types.ts` 中的 `LopConfig`:
```typescript
export interface LopConfig {
    provider?: Provider  // 代替内联联合类型
    // ...
}
```

3. 更新 `src/llm.ts`:
```typescript
// 删除第 8 行，添加 import:
import type { Provider } from "./protocol/types.js"
```

4. 更新 `src/server/agent.ts`:
```typescript
// 从 AgentConfig 中删除 provider 类型， 添加 import:
import type { Provider } from "../protocol/types.js"

export interface AgentConfig {
  provider: Provider  // 代替内联联合类型
  // ...
}
```

**测试:**
- 验证 TypeScript 编译成功支持 google provider
- 测试配置加载支持 google provider

**验证:**
```bash
npm run build
# 应该编译无错误
```

---

### 任务 4: 添加安全钩子实现 (P1 - 高)

**问题:** 安全钩子存在但未实现。 需要权限策略、危险命令确认。

**文件:**
- 创建: `src/server/security/policy.ts`
- 创建: `src/server/security/__tests__/policy.test.ts`
- 修改: `src/server/agent.ts` (集成策略)
- 修改: `src/server/tools/bash.ts` (添加危险命令列表)

**实现:**

1. 创建 `src/server/security/policy.ts`:
```typescript
export type PermissionLevel = "allow" | "ask" | "deny"

export interface ToolPolicy {
  toolName: string
  permission: PermissionLevel
  patterns?: string[]  // 例如 bash 的危险命令
}

export const DANGEROUS_BASH_COMMANDS = [
  // 文件系统破坏
  "rm", "rmdir", "shred",
  // 磁盘操作
  "dd", "mkfs", "fdisk", "parted", "format",
  // 系统电源
  "shutdown", "reboot", "poweroff", "halt",
  // 权限更改
  "chmod", "chown", "chgrp",
  // 网络操作 (潜在危险)
  "curl", "wget", "nc", "netcat",
  // 代码执行
  "eval", "exec", "source",
  // 包管理器 (可能安装恶意包)
  "npm", "yarn", "pnpm", "pip", "pip3",
  // Git 强制操作
  "git push --force", "git push -f", "git reset --hard",
]

export function evaluateToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
  policies: ToolPolicy[]
): PermissionLevel {
  // 首先检查显式策略
  const policy = policies.find(p => p.toolName === toolName)
  if (policy) return policy.permission

  // 默认危险操作设为 "ask"
  if (toolName === "bash") {
    const commandStr = String(args.command || "")
    // 提取基础命令 (第一个词， 处理 sudo)
    const baseCommand = commandStr.split(/\s+/)[0] === "sudo"
      ? commandStr.split(/\s+/)[1]
      : commandStr.split(/\s+/)[0]

    // 检查危险命令列表
    if (DANGEROUS_BASH_COMMANDS.some(cmd => baseCommand === cmd || commandStr.includes(cmd))) {
      return "ask"
    }
  }

  if (toolName === "write" || toolName === "edit") {
    // 写入 cwd 外部时询问
    const filePath = String(args.file_path || "")
    if (filePath.startsWith("..") || filePath.startsWith("/")) {
      return "ask"
    }
  }

  return "allow"
}
```

2. 在 `src/server/agent.ts` 中集成代理钩子:
```typescript
// 在 executeTool 方法中. 增强 beforeToolExecute 逻辑

// 现有的 hooks.beforeToolExecute 返回 "allow" | "deny" | "ask"
// 对于 "ask"， 需要实现用户确认流程:
// - 向客户端返回特殊事件请求权限
// - 客户端响应 allow/deny
// - 代理继续或取消工具执行

// 注意: 完整的 "ask" 流程需要客户端-服务端协议扩展
// 这是一个更大的改动 - 目前. 将 "ask" 视为带消息的 "deny"
```

**测试:**
- 测试危险 bash 命令触发 "ask" (或临时 "deny")
- 测试安全命令返回 "allow"
- 测试写入 cwd 外部触发 "ask"
- 测试 "rm -rf" 与 "rm -r" 的模式匹配

**验证:**
```bash
npm run build
npm test
```

---

### 任务 5: 抽取 TUI 状态管理 (P3 - 较低优先级)

**问题:** `src/tui/App.tsx` 职责过多: 消息、流式、思考、工具状态、命令、主题、调整大小都在一个组件中。

**文件:**
- 创建: `src/tui/state/sessionReducer.ts`
- 创建: `src/tui/state/types.ts`
- 修改: `src/tui/App.tsx` (使用 reducer)
- 创建: `src/tui/state/__tests__/sessionReducer.test.ts`

**实现:**

1. 创建 `src/tui/state/types.ts`:
```typescript
export interface SessionState {
  messages: Message[]
  streaming: StreamingState
  isLoading: boolean
}

export type SessionAction =
  | { type: "ADD_MESSAGE"; message: Message }
  | { type: "APPEND_CONTENT"; delta: string }
  | { type: "APPEND_THINKING"; delta: string }
  | { type: "END_THINKING" }
  | { type: "TOOL_CALL"; id: string; name: string; args: Record<string, unknown> }
  | { type: "TOOL_RESULT"; id: string; content: string; isError?: boolean }
  | { type: "STREAM_DONE"; content: string }
  | { type: "CLEAR_MESSAGES" }
  | { type: "SET_LOADING"; loading: boolean }
```

2. 创建 `src/tui/state/sessionReducer.ts`:
```typescript
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] }
    case "APPEND_CONTENT":
      return { ...state, streaming: { ...state.streaming, content: state.streaming.content + action.delta } }
    // ... 处理所有 action
    default:
      return state
  }
}
```

3. 重构 `App.tsx` 使用 `useReducer`:
```typescript
import { useReducer } from "react"
import { sessionReducer, initialState } from "./state/sessionReducer"

// 用以下代码替换多个 useState 调用:
const [state, dispatch] = useReducer(sessionReducer, initialState)

// 用 dispatch 调用替换 setMessages/setStreaming 等
```

**测试:**
- 测试 reducer 处理所有 action 类型
- 测试状态转换正确

**验证:**
```bash
npm run build
npm test
```

---

## 执行顺序

1. **任务 1** (工具结果注入) - 必须第一个 - 修复核心功能
2. **任务 2** (stdout 污染) - 快速修复. 防止协议损坏
3. **任务 3** (Provider 类型) - 快速类型修复. 启用 google provider
4. **任务 4** (安全) - 生产环境重要
5. **任务 5** (TUI 状态) - 可延后. 提升可维护性

## 提交策略

每个任务完成后:
```bash
git add -A
git commit -m "fix(agent): [任务 N] 描述"
```

## 验证命令

```bash
# 所有任务完成后
npm run build
npm test
```

## 任务依赖关系

```
任务 1 ─────────────────────────────────────────────┐
任务 2 ─────────────────────────────────────────────┼──> 最终验证
任务 3 ─────────────────────────────────────────────┤
任务 4 (可与 1-3 并行) ────────────────────────────┤
任务 5 (可延后) ──────────────────────────────────────┘
```

任务 1、2、3 可以并行执行（无依赖）。
任务 4 依赖任务 1 的钩子结构稳定。
任务 5 独立，可以最后或延后执行。

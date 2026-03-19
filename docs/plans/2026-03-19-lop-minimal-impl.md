# lop_minimal Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 创建一个极简版 AI 编码助手，采用 Client-Server 架构，通过 stdio + JSON-RPC 通信。

**Architecture:** Client 进程 spawn Server 子进程，通过 stdin/stdout 进行 JSON-RPC 2.0 通信。Server 端实现 LLM + Tool 循环，Client 端处理用户交互。

**Tech Stack:** TypeScript, Node.js, Vercel AI SDK, Zod

---

## Task 1: 项目初始化

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: 创建 package.json**

```bash
cd /home/xjingyao/code/opencode_lite/lop_minimal
```

```json
{
  "name": "lop_minimal",
  "version": "0.1.0",
  "type": "module",
  "description": "Minimal AI coding agent with client-server architecture",
  "bin": {
    "lop-minimal": "./dist/index.js"
  },
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/index.ts",
    "start": "node dist/index.js",
    "server": "tsx src/server/index.ts"
  },
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.3.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.9.0"
  },
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: 创建 .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
```

**Step 4: 安装依赖**

```bash
npm install
```

Expected: 依赖安装成功

**Step 5: Commit**

```bash
git init
git add .
git commit -m "chore: initialize project structure"
```

---

## Task 2: 协议类型定义

**Files:**
- Create: `src/protocol/types.ts`

**Step 1: 创建协议类型文件**

```typescript
// src/protocol/types.ts
import { z } from "zod"

// JSON-RPC 2.0 基础类型
export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id?: number | string
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: "2.0"
  id: number | string
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface JsonRpcNotification {
  jsonrpc: "2.0"
  method: string
  params?: unknown
}

// 协议方法参数
export const InitializeParamsSchema = z.object({
  clientInfo: z.object({
    name: z.string(),
    version: z.string().optional(),
  }).optional(),
})

export type InitializeParams = z.infer<typeof InitializeParamsSchema>

export const ChatParamsSchema = z.object({
  message: z.string(),
  cwd: z.string().optional(),
})

export type ChatParams = z.infer<typeof ChatParamsSchema>

// 通知类型
export interface ContentNotification extends JsonRpcNotification {
  method: "content"
  params: {
    delta: string
  }
}

export interface ToolCallNotification extends JsonRpcNotification {
  method: "tool_call"
  params: {
    id: string
    name: string
    args: Record<string, unknown>
  }
}

export interface ToolResultNotification extends JsonRpcNotification {
  method: "tool_result"
  params: {
    id: string
    result: string
    isError?: boolean
  }
}

export interface DoneNotification extends JsonRpcNotification {
  method: "done"
  params: {
    finishReason: "stop" | "tool_calls" | "interrupted" | "error"
  }
}

export type ServerNotification =
  | ContentNotification
  | ToolCallNotification
  | ToolResultNotification
  | DoneNotification
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/protocol/types.ts
git commit -m "feat: add protocol type definitions"
```

---

## Task 3: LLM 客户端

**Files:**
- Create: `src/llm.ts`

**Step 1: 创建 LLM 客户端**

```typescript
// src/llm.ts
import { streamText } from "ai"
import { openai } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import type { CoreMessage, Tool } from "ai"

export type Provider = "openai" | "anthropic" | "openrouter"

export interface LLMConfig {
  provider: Provider
  model: string
}

export interface StreamResult {
  content: string
  toolCalls: Array<{
    id: string
    name: string
    args: Record<string, unknown>
  }>
  finishReason: string
}

export class LLMClient {
  private config: LLMConfig

  constructor(config: LLMConfig) {
    this.config = config
  }

  private getModel() {
    switch (this.config.provider) {
      case "openai":
        return openai(this.config.model)
      case "anthropic":
        return anthropic(this.config.model)
      case "openrouter":
        // OpenRouter 使用 openai 兼容 API
        return openai(this.config.model, {
          baseURL: "https://openrouter.ai/api/v1",
          headers: {
            "HTTP-Referer": "https://github.com/lop-minimal",
          },
        })
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`)
    }
  }

  async *stream(
    messages: CoreMessage[],
    tools: Record<string, Tool>
  ): AsyncGenerator<
    | { type: "content"; delta: string }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "done"; finishReason: string }
  > {
    const model = this.getModel()

    const result = streamText({
      model,
      messages,
      tools,
      maxSteps: 10,
    })

    let fullContent = ""
    const toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }> = []

    for await (const chunk of (await result).fullStream) {
      if (chunk.type === "text-delta") {
        fullContent += chunk.textDelta
        yield { type: "content", delta: chunk.textDelta }
      } else if (chunk.type === "tool-call") {
        toolCalls.push({
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: chunk.args as Record<string, unknown>,
        })
        yield {
          type: "tool_call",
          id: chunk.toolCallId,
          name: chunk.toolName,
          args: chunk.args as Record<string, unknown>,
        }
      }
    }

    const finalResult = await result
    yield {
      type: "done",
      finishReason: finalResult.finishReason || "stop",
    }
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/llm.ts
git commit -m "feat: add LLM client with streaming support"
```

---

## Task 4: 工具系统 - 基础结构

**Files:**
- Create: `src/server/tools/types.ts`
- Create: `src/server/tools/index.ts`

**Step 1: 创建工具类型定义**

```typescript
// src/server/tools/types.ts
import { z } from "zod"

export interface Tool<T extends z.ZodType = z.ZodType> {
  name: string
  description: string
  parameters: T
  execute: (params: z.infer<T>, ctx: ToolContext) => Promise<string>
}

export interface ToolContext {
  cwd: string
}
```

**Step 2: 创建工具注册中心**

```typescript
// src/server/tools/index.ts
import type { Tool } from "./types.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { bashTool } from "./bash.js"

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  constructor() {
    // 注册内置工具
    this.register(readTool)
    this.register(writeTool)
    this.register(editTool)
    this.register(bashTool)
  }

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  /** 获取 AI SDK 格式的工具定义 */
  getToolDefinitions(): Record<string, { description: string; parameters: z.ZodType }> {
    const defs: Record<string, { description: string; parameters: z.ZodType }> = {}
    for (const tool of this.getAll()) {
      defs[tool.name] = {
        description: tool.description,
        parameters: tool.parameters,
      }
    }
    return defs
  }
}

export * from "./types.js"
```

**Step 3: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 会有工具未定义的错误，继续下一步

**Step 4: Commit**

```bash
git add src/server/tools/types.ts src/server/tools/index.ts
git commit -m "feat: add tool registry"
```

---

## Task 5: 工具系统 - read 工具

**Files:**
- Create: `src/server/tools/read.ts`

**Step 1: 创建 read 工具**

```typescript
// src/server/tools/read.ts
import { z } from "zod"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import type { Tool } from "./types.js"

export const readTool: Tool = {
  name: "read",
  description: `Read a file from the filesystem.
- Returns the file content with line numbers.
- Can read any text file including code, config, markdown.
- For large files, use offset and limit parameters.`,

  parameters: z.object({
    path: z.string().describe("Absolute path to the file"),
    offset: z.number().optional().describe("Starting line number (1-based)"),
    limit: z.number().optional().describe("Number of lines to read"),
  }),

  async execute({ path, offset = 1, limit }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    if (!existsSync(fullPath)) {
      return `Error: File not found: ${fullPath}`
    }

    try {
      const content = await readFile(fullPath, "utf-8")
      const lines = content.split("\n")

      const startLine = Math.max(1, offset) - 1
      const endLine = limit ? startLine + limit : lines.length
      const selectedLines = lines.slice(startLine, endLine)

      // 添加行号
      const numbered = selectedLines
        .map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`)
        .join("\n")

      return numbered
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/tools/read.ts
git commit -m "feat: add read tool"
```

---

## Task 6: 工具系统 - write 工具

**Files:**
- Create: `src/server/tools/write.ts`

**Step 1: 创建 write 工具**

```typescript
// src/server/tools/write.ts
import { z } from "zod"
import { writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { Tool } from "./types.js"

export const writeTool: Tool = {
  name: "write",
  description: `Write content to a file.
- Creates the file if it doesn't exist.
- Overwrites existing content.
- Creates parent directories if needed.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write"),
  }),

  async execute({ path, content }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    try {
      // 确保目录存在
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, content, "utf-8")
      return `Successfully wrote ${content.length} characters to ${fullPath}`
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/tools/write.ts
git commit -m "feat: add write tool"
```

---

## Task 7: 工具系统 - edit 工具

**Files:**
- Create: `src/server/tools/edit.ts`

**Step 1: 创建 edit 工具**

```typescript
// src/server/tools/edit.ts
import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import type { Tool } from "./types.js"

export const editTool: Tool = {
  name: "edit",
  description: `Edit a file by replacing specific text.
- Performs exact string replacement.
- The old_string must match exactly (including whitespace).
- Returns error if old_string is not found or appears multiple times.`,

  parameters: z.object({
    path: z.string().describe("Path to the file"),
    old_string: z.string().describe("Text to replace (must match exactly)"),
    new_string: z.string().describe("Replacement text"),
  }),

  async execute({ path, old_string, new_string }, ctx) {
    const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

    try {
      const content = await readFile(fullPath, "utf-8")

      // 检查唯一性
      const occurrences = content.split(old_string).length - 1
      if (occurrences === 0) {
        return `Error: old_string not found in file`
      }
      if (occurrences > 1) {
        return `Error: old_string appears ${occurrences} times, must be unique`
      }

      const newContent = content.replace(old_string, new_string)
      await writeFile(fullPath, newContent, "utf-8")

      return `Successfully edited ${fullPath}`
    } catch (error: any) {
      return `Error: ${error.message}`
    }
  },
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/tools/edit.ts
git commit -m "feat: add edit tool"
```

---

## Task 8: 工具系统 - bash 工具

**Files:**
- Create: `src/server/tools/bash.ts`

**Step 1: 创建 bash 工具**

```typescript
// src/server/tools/bash.ts
import { z } from "zod"
import { spawn } from "child_process"
import type { Tool } from "./types.js"

export const bashTool: Tool = {
  name: "bash",
  description: `Execute a shell command.
- Use for system operations, running scripts, git commands, etc.
- Commands run in the project directory.
- Avoid interactive commands that require user input.`,

  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z.number().optional().default(30000).describe("Timeout in ms"),
  }),

  async execute({ command, timeout }, ctx) {
    return new Promise((resolve) => {
      const proc = spawn(command, [], {
        cwd: ctx.cwd,
        shell: true,
        timeout,
      })

      let stdout = ""
      let stderr = ""

      proc.stdout.on("data", (data) => {
        stdout += data.toString()
      })

      proc.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      proc.on("close", (code) => {
        let result = ""
        if (stdout) result += `STDOUT:\n${stdout}`
        if (stderr) result += `${result ? "\n" : ""}STDERR:\n${stderr}`
        if (code !== 0) result += `\nExit code: ${code}`
        resolve(result || "Command completed with no output")
      })

      proc.on("error", (error) => {
        resolve(`Error: ${error.message}`)
      })
    })
  },
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/tools/bash.ts
git commit -m "feat: add bash tool"
```

---

## Task 9: 消息存储

**Files:**
- Create: `src/server/store.ts`

**Step 1: 创建消息存储接口和内存实现**

```typescript
// src/server/store.ts
import type { CoreMessage } from "ai"

export interface MessageStore {
  add(message: CoreMessage): void
  getAll(): CoreMessage[]
  clear(): void
}

export class InMemoryStore implements MessageStore {
  private messages: CoreMessage[] = []

  add(message: CoreMessage): void {
    this.messages.push(message)
  }

  getAll(): CoreMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/store.ts
git commit -m "feat: add message store interface and in-memory implementation"
```

---

## Task 10: Hook 系统

**Files:**
- Create: `src/server/hooks/types.ts`

**Step 1: 创建 Hook 类型定义**

```typescript
// src/server/hooks/types.ts
import type { z } from "zod"
import type { Tool } from "../tools/types.js"

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

export type PolicyDecision = "allow" | "deny" | "ask"

export interface LoopPattern {
  type: "tool_repeat" | "content_repeat"
  details: string
}

export interface AgentHooks {
  /** 工具执行前 - 用于策略引擎 */
  beforeToolExecute?(call: ToolCall, tool: Tool): Promise<PolicyDecision>

  /** LLM 调用前 - 用于循环检测 */
  beforeLLMCall?(messages: unknown[]): Promise<void>

  /** 检测到循环时 - 返回 true 继续执行，false 中断 */
  onLoopDetected?(pattern: LoopPattern): Promise<boolean>
}

// 空实现，用于默认值
export const noopHooks: AgentHooks = {}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/hooks/types.ts
git commit -m "feat: add hook type definitions for future extensibility"
```

---

## Task 11: Agent 核心

**Files:**
- Create: `src/server/agent.ts`

**Step 1: 创建 Agent 类**

```typescript
// src/server/agent.ts
import type { CoreMessage } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"

export interface AgentConfig {
  provider: "openai" | "anthropic" | "openrouter"
  model: string
  cwd: string
  store?: MessageStore
  hooks?: AgentHooks
}

export type AgentEvent =
  | { type: "content"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string; isError?: boolean }
  | { type: "done"; finishReason: string }

export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private hooks: AgentHooks
  private cwd: string

  constructor(config: AgentConfig) {
    this.llm = new LLMClient({
      provider: config.provider,
      model: config.model,
    })
    this.tools = new ToolRegistry()
    this.store = config.store ?? new InMemoryStore()
    this.hooks = config.hooks ?? noopHooks
    this.cwd = config.cwd
  }

  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    // 添加用户消息
    this.store.add({ role: "user", content: userMessage })

    // 获取当前消息历史
    const messages = this.store.getAll()

    // 获取工具定义
    const toolDefs = this.tools.getToolDefinitions()

    // 调用 LLM 流式
    const stream = this.llm.stream(messages, toolDefs)

    let assistantContent = ""

    for await (const chunk of stream) {
      if (chunk.type === "content") {
        assistantContent += chunk.delta
        yield { type: "content", delta: chunk.delta }
      } else if (chunk.type === "tool_call") {
        yield { type: "tool_call", id: chunk.id, name: chunk.name, args: chunk.args }

        // 执行工具
        const result = await this.executeTool(chunk)
        yield { type: "tool_result", id: chunk.id, result: result.content, isError: result.isError }
      } else if (chunk.type === "done") {
        // 保存 assistant 消息
        if (assistantContent) {
          this.store.add({ role: "assistant", content: assistantContent })
        }

        yield { type: "done", finishReason: chunk.finishReason }
      }
    }
  }

  private async executeTool(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
    const tool = this.tools.get(call.name)

    if (!tool) {
      return { content: `Error: Unknown tool '${call.name}'`, isError: true }
    }

    // Hook: 工具执行前
    if (this.hooks.beforeToolExecute) {
      const decision = await this.hooks.beforeToolExecute(call, tool)
      if (decision === "deny") {
        return { content: `Error: Tool execution denied by policy`, isError: true }
      }
      // TODO: 处理 "ask" 决策 (需要与 client 交互)
    }

    const ctx: ToolContext = { cwd: this.cwd }

    try {
      const content = await tool.execute(call.args as any, ctx)
      return { content }
    } catch (error: any) {
      return { content: `Error: ${error.message}`, isError: true }
    }
  }

  clearHistory(): void {
    this.store.clear()
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat: add agent core with streaming and tool execution"
```

---

## Task 12: Server 入口

**Files:**
- Create: `src/server/index.ts`

**Step 1: 创建 Server 入口**

```typescript
// src/server/index.ts
import * as readline from "readline"
import { Agent, type AgentConfig, type AgentEvent } from "./agent.js"
import type { JsonRpcRequest, JsonRpcNotification } from "../protocol/types.js"

let agent: Agent | null = null
let currentCwd = process.cwd()

// 发送 JSON-RPC 通知
function sendNotification(notification: JsonRpcNotification): void {
  console.log(JSON.stringify(notification))
}

// 发送 JSON-RPC 响应
function sendResponse(id: number | string, result: unknown): void {
  console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
}

// 发送 JSON-RPC 错误
function sendError(id: number | string, code: number, message: string): void {
  console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }))
}

// 处理请求
async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { method, params, id } = request

  switch (method) {
    case "initialize": {
      const config: AgentConfig = {
        provider: process.env.LOP_PROVIDER as AgentConfig["provider"] ?? "openai",
        model: process.env.LOP_MODEL ?? "gpt-4o",
        cwd: currentCwd,
      }
      agent = new Agent(config)

      sendResponse(id ?? 0, {
        serverInfo: {
          name: "lop_minimal_server",
          version: "0.1.0",
        },
        capabilities: {},
      })
      break
    }

    case "chat": {
      if (!agent) {
        sendError(id ?? 0, -32002, "Not initialized")
        return
      }

      const { message, cwd } = params as { message: string; cwd?: string }
      if (cwd) {
        currentCwd = cwd
        // 重新创建 agent 以使用新的 cwd
        const config: AgentConfig = {
          provider: process.env.LOP_PROVIDER as AgentConfig["provider"] ?? "openai",
          model: process.env.LOP_MODEL ?? "gpt-4o",
          cwd: currentCwd,
        }
        agent = new Agent(config)
      }

      // 流式处理 agent 事件
      try {
        for await (const event of agent.run(message)) {
          switch (event.type) {
            case "content":
              sendNotification({ jsonrpc: "2.0", method: "content", params: { delta: event.delta } })
              break
            case "tool_call":
              sendNotification({
                jsonrpc: "2.0",
                method: "tool_call",
                params: { id: event.id, name: event.name, args: event.args },
              })
              break
            case "tool_result":
              sendNotification({
                jsonrpc: "2.0",
                method: "tool_result",
                params: { id: event.id, result: event.result, isError: event.isError },
              })
              break
            case "done":
              sendNotification({
                jsonrpc: "2.0",
                method: "done",
                params: { finishReason: event.finishReason },
              })
              break
          }
        }
        sendResponse(id ?? 0, {})
      } catch (error: any) {
        sendError(id ?? 0, -32000, error.message)
      }
      break
    }

    case "clear": {
      if (agent) {
        agent.clearHistory()
      }
      sendResponse(id ?? 0, {})
      break
    }

    default:
      sendError(id ?? 0, -32601, `Method not found: ${method}`)
  }
}

// 主循环
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
})

rl.on("line", (line) => {
  try {
    const request = JSON.parse(line) as JsonRpcRequest
    handleRequest(request).catch((error) => {
      sendError(request.id ?? 0, -32000, error.message)
    })
  } catch (error: any) {
    sendError(0, -32700, "Parse error")
  }
})
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add server entry with JSON-RPC handler"
```

---

## Task 13: Client - JSON-RPC 通信

**Files:**
- Create: `src/client/index.ts`

**Step 1: 创建 Client 类**

```typescript
// src/client/index.ts
import { spawn, type ChildProcess } from "child_process"
import * as readline from "readline"
import type { JsonRpcRequest, JsonRpcNotification, ServerNotification } from "../protocol/types.js"

export interface ClientOptions {
  cwd?: string
  provider?: string
  model?: string
}

export type ClientEvent =
  | { type: "content"; delta: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; result: string; isError?: boolean }
  | { type: "done"; finishReason: string }

export class Client {
  private server: ChildProcess
  private requestId = 0
  private pendingRequests = new Map<number | string, { resolve: Function; reject: Function }>()
  private eventHandler?: (event: ClientEvent) => void

  constructor(options: ClientOptions = {}) {
    // 启动 server 子进程
    const env: Record<string, string> = {}
    if (options.provider) env.LOP_PROVIDER = options.provider
    if (options.model) env.LOP_MODEL = options.model

    this.server = spawn("node", ["dist/server/index.js"], {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: process.cwd(),
      env: { ...process.env, ...env },
    })

    // 处理 server 输出
    const rl = readline.createInterface({
      input: this.server.stdout!,
      terminal: false,
    })

    rl.on("line", (line) => {
      this.handleMessage(JSON.parse(line))
    })

    this.server.on("error", (error) => {
      console.error("Server error:", error)
    })
  }

  private handleMessage(message: any): void {
    if (message.method) {
      // 通知
      this.handleNotification(message as JsonRpcNotification)
    } else if (message.id !== undefined) {
      // 响应
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        this.pendingRequests.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (!this.eventHandler) return

    switch (notification.method) {
      case "content":
        this.eventHandler({ type: "content", delta: (notification.params as any).delta })
        break
      case "tool_call":
        this.eventHandler({
          type: "tool_call",
          id: (notification.params as any).id,
          name: (notification.params as any).name,
          args: (notification.params as any).args,
        })
        break
      case "tool_result":
        this.eventHandler({
          type: "tool_result",
          id: (notification.params as any).id,
          result: (notification.params as any).result,
          isError: (notification.params as any).isError,
        })
        break
      case "done":
        this.eventHandler({
          type: "done",
          finishReason: (notification.params as any).finishReason,
        })
        break
    }
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }

      this.pendingRequests.set(id, { resolve, reject })
      this.server.stdin!.write(JSON.stringify(request) + "\n")
    })
  }

  async initialize(): Promise<void> {
    await this.sendRequest("initialize", { clientInfo: { name: "lop_minimal_cli", version: "0.1.0" } })
  }

  onEvent(handler: (event: ClientEvent) => void): void {
    this.eventHandler = handler
  }

  async chat(message: string, cwd?: string): Promise<void> {
    await this.sendRequest("chat", { message, cwd })
  }

  async clear(): Promise<void> {
    await this.sendRequest("clear")
  }

  close(): void {
    this.server.kill()
  }
}
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/client/index.ts
git commit -m "feat: add client with JSON-RPC communication"
```

---

## Task 14: CLI 入口

**Files:**
- Create: `src/index.ts`

**Step 1: 创建 CLI 入口**

```typescript
// src/index.ts
#!/usr/bin/env node
import * as readline from "readline"
import { Client, type ClientEvent } from "./client/index.js"

interface CLIOptions {
  provider?: string
  model?: string
  cwd?: string
}

function parseArgs(): CLIOptions {
  const args = process.argv.slice(2)
  const options: CLIOptions = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === "-p" || arg === "--provider") {
      options.provider = args[++i]
    } else if (arg === "-m" || arg === "--model") {
      options.model = args[++i]
    } else if (arg === "-d" || arg === "--directory") {
      options.cwd = args[++i]
    }
  }

  return options
}

async function main() {
  const options = parseArgs()
  const cwd = options.cwd ?? process.cwd()

  console.log("lop_minimal v0.1.0")
  console.log(`Provider: ${options.provider ?? "openai"}`)
  console.log(`Model: ${options.model ?? "gpt-4o"}`)
  console.log(`Working directory: ${cwd}`)
  console.log("\nType your message and press Enter. Ctrl+C to exit.\n")

  const client = new Client(options)

  // 设置事件处理器
  client.onEvent((event: ClientEvent) => {
    switch (event.type) {
      case "content":
        process.stdout.write(event.delta)
        break
      case "tool_call":
        console.log(`\n🔧 ${event.name}(${JSON.stringify(event.args)})`)
        break
      case "tool_result":
        const icon = event.isError ? "❌" : "✅"
        console.log(`${icon} ${event.result.slice(0, 200)}${event.result.length > 200 ? "..." : ""}`)
        break
      case "done":
        console.log("\n")
        break
    }
  })

  // 初始化
  await client.initialize()

  // REPL 循环
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  const prompt = () => {
    rl.question("> ", async (input) => {
      const trimmed = input.trim()

      if (!trimmed) {
        prompt()
        return
      }

      if (trimmed === "/clear") {
        await client.clear()
        console.log("History cleared.\n")
        prompt()
        return
      }

      if (trimmed === "/help") {
        console.log(`
Commands:
  /clear  - Clear conversation history
  /help   - Show this help
  Ctrl+C  - Exit
        `)
        prompt()
        return
      }

      try {
        await client.chat(trimmed, cwd)
      } catch (error: any) {
        console.error(`Error: ${error.message}\n`)
      }

      prompt()
    })
  }

  // 处理退出
  rl.on("close", () => {
    client.close()
    console.log("Goodbye!")
  })

  prompt()
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
```

**Step 2: 验证编译**

```bash
npx tsc --noEmit
```

Expected: 无错误

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry with REPL loop"
```

---

## Task 15: 构建和测试

**Files:**
- Modify: `package.json`

**Step 1: 构建项目**

```bash
npm run build
```

Expected: 编译成功，生成 dist 目录

**Step 2: 测试运行**

```bash
# 设置 API Key
export OPENAI_API_KEY=sk-...

# 运行
node dist/index.js
```

Expected: 启动 REPL，可以输入消息

**Step 3: 最终 Commit**

```bash
git add .
git commit -m "chore: build and verify project"
```

---

## 完成检查清单

- [ ] 项目初始化完成
- [ ] 协议类型定义完成
- [ ] LLM 客户端完成
- [ ] 4 个工具实现完成
- [ ] 消息存储完成
- [ ] Hook 系统预留完成
- [ ] Agent 核心完成
- [ ] Server 入口完成
- [ ] Client 通信完成
- [ ] CLI 入口完成
- [ ] 构建成功
- [ ] 基本运行测试通过

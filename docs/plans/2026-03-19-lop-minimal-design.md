# lop_minimal 设计文档

极简版 AI 编码助手，采用 Client-Server 架构。

## 设计目标

- **极简核心**: LLM + Tool 循环，无持久化、无 TUI、无策略引擎
- **Client-Server 架构**: CLI 在 client，核心逻辑在 server
- **可扩展**: 预留 hook 点和接口，支持后续添加功能

## 架构概览

```
┌─────────────────┐     stdio      ┌─────────────────┐
│     Client      │ ◄───────────► │     Server      │
│   (CLI 界面)     │   JSON-RPC    │  (Agent 循环)   │
└─────────────────┘               └────────┬────────┘
                                           │
                              ┌────────────┼────────────┐
                              ▼            ▼            ▼
                        ┌─────────┐  ┌─────────┐  ┌─────────┐
                        │   LLM   │  │  Tools  │  │  Store  │
                        │ Client  │  │Registry │  │(Memory) │
                        └─────────┘  └─────────┘  └─────────┘
```

## 项目结构

```
lop_minimal/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts           # CLI 入口，启动 server 子进程
│   ├── client/
│   │   └── index.ts       # JSON-RPC client
│   ├── server/
│   │   ├── index.ts       # Server 入口，监听 stdin
│   │   ├── agent.ts       # Agent 循环 + hooks
│   │   ├── store.ts       # MessageStore 接口 + 内存实现
│   │   ├── hooks/
│   │   │   └── types.ts   # Hook 接口定义
│   │   └── tools/
│   │       ├── index.ts   # Tool 注册
│   │       ├── read.ts
│   │       ├── write.ts
│   │       ├── edit.ts
│   │       └── bash.ts
│   ├── protocol/
│   │   └── types.ts       # JSON-RPC 消息类型
│   └── llm.ts             # LLM 客户端封装
└── docs/
    └── plans/
        └── 2026-03-19-lop-minimal-design.md
```

## 通信协议

基于 JSON-RPC 2.0，通过 stdio 通信。

### 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "chat",
  "params": {
    "message": "用户输入",
    "cwd": "/path/to/project"
  }
}
```

### 响应格式 (流式通知)

```json
{ "jsonrpc": "2.0", "method": "content", "params": { "delta": "..." } }
{ "jsonrpc": "2.0", "method": "tool_call", "params": { "name": "read", "args": {...} } }
{ "jsonrpc": "2.0", "method": "tool_result", "params": { "result": "..." } }
{ "jsonrpc": "2.0", "method": "done", "params": { "finishReason": "stop" } }
```

### 核心方法

| 方法 | 描述 |
|------|------|
| `initialize` | 初始化连接，交换元数据 |
| `chat` | 发送用户消息，启动 agent 循环 |
| `interrupt` | 中断当前执行 |

## Agent 循环

```
1. 接收 chat 请求
       ↓
2. 调用 beforeLLMCall hook (预留)
       ↓
3. 调用 LLM (流式)
   - 发送 content delta 通知
   - 检测 tool calls
       ↓
4. 如有 tool calls:
   - 发送 tool_call 通知
   - 调用 beforeToolExecute hook (预留)
   - 执行工具
   - 发送 tool_result 通知
   - 回到步骤 2
       ↓
5. 发送 done 通知
```

## LLM 客户端

使用 Vercel AI SDK，支持多 provider。

### 支持的 Providers

- `openai` - OpenAI API
- `anthropic` - Anthropic API
- `openrouter` - OpenRouter API

### 环境变量

```bash
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
```

### 默认配置

- Provider: `openai`
- Model: `gpt-4o`
- maxSteps: 10

## 工具集

### 核心 4 工具

| 工具 | 描述 |
|------|------|
| `read` | 读取文件内容 |
| `write` | 写入文件 (覆盖) |
| `edit` | 编辑文件 (字符串替换) |
| `bash` | 执行 shell 命令 |

## 扩展点预留

### Hook 接口

```typescript
interface AgentHooks {
  // 工具执行前 - 用于策略引擎
  beforeToolExecute?(call: ToolCall): Promise<PolicyDecision>

  // LLM 调用前 - 用于循环检测
  beforeLLMCall?(messages: Message[]): Promise<void>

  // 检测到循环时 - 用于中断或恢复
  onLoopDetected?(pattern: LoopPattern): Promise<boolean>
}

type PolicyDecision = 'allow' | 'deny' | 'ask'
```

### MessageStore 接口

```typescript
interface MessageStore {
  add(message: Message): void
  getAll(): Message[]
  clear(): void
}

// 当前实现: InMemoryStore
// 未来可扩展: SQLiteStore, FileStore
```

### ToolRegistry

```typescript
interface ToolRegistry {
  register(tool: Tool): void
  get(name: string): Tool | undefined
  getAll(): Tool[]
}
```

## 命令行接口

```bash
lop-minimal                    # 启动交互模式
lop-minimal -m gpt-4o          # 指定模型
lop-minimal -p anthropic       # 指定 provider
lop-minimal -d /path/to/proj   # 指定工作目录
```

## 当前版本不包含

以下功能预留扩展点，但不在此版本实现：

- ❌ 消息持久化 (预留 MessageStore 接口)
- ❌ TUI 界面 (Client/Server 分离，可替换)
- ❌ 策略引擎 (预留 beforeToolExecute hook)
- ❌ 循环检测 (预留 beforeLLMCall hook)
- ❌ MCP/Skill 支持 (预留 ToolRegistry 动态注册)

## 代码量预估

| 模块 | 预估行数 |
|------|----------|
| index.ts (CLI) | ~50 |
| client/index.ts | ~80 |
| server/index.ts | ~50 |
| server/agent.ts | ~150 |
| server/store.ts | ~30 |
| server/hooks/types.ts | ~30 |
| server/tools/* (4 files) | ~200 |
| protocol/types.ts | ~60 |
| llm.ts | ~100 |
| **总计** | **~750 行** |

## 依赖

```json
{
  "dependencies": {
    "ai": "^4.0.0",
    "@ai-sdk/openai": "^1.0.0",
    "@ai-sdk/anthropic": "^1.0.0",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0"
  }
}
```

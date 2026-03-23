# Code Agent 从零开发设计文档

> 目标：从零开始构建一个对标 Claude Code 的 code agent 项目
> 技术栈：TypeScript + Node.js
> 方案：渐进式 MVP

## 1. 项目概述

### 1.1 目标

构建一个功能完整的 code agent，支持：

- 多模型接入（可扩展的多模型系统）
- 丰富的工具集（文件操作、代码搜索、Shell 执行等）
- CLI TUI 界面
- 上下文压缩与历史管理

### 1.2 设计原则

1. **渐进式开发**：从 MVP 开始，逐步迭代
2. **接口优先**：核心抽象先定义接口，再实现
3. **最小依赖**：只引入必要的依赖
4. **可测试**：每个模块都可独立测试

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    CLI 层 (Ink + React)                      │
│    命令解析、TUI 渲染、用户交互                               │
├─────────────────────────────────────────────────────────────┤
│                    Agent 层 (Client)                         │
│    AgentClient: 对话循环、历史管理、压缩策略                  │
│    Turn: 单轮对话处理、事件流                                 │
├─────────────────────────────────────────────────────────────┤
│                    工具层 (Tools)                            │
│    BaseTool: 工具抽象基类                                    │
│    ToolInvocation: 参数验证 + 执行分离                       │
│    ToolRegistry: 工具注册与发现                              │
├─────────────────────────────────────────────────────────────┤
│                    模型层 (LLM)                              │
│    ContentGenerator: 统一的生成接口                          │
│    多 Provider 实现: OpenAI / Anthropic / 本地模型           │
│    ModelRegistry: 模型能力注册与配置解析                     │
├─────────────────────────────────────────────────────────────┤
│                    配置与存储层 (Config)                      │
│    Config: 全局配置聚合器                                    │
│    Storage: 文件系统、临时目录、工作区上下文                  │
└─────────────────────────────────────────────────────────────┘
```

### 2.1 核心抽象

| 抽象               | 职责                                     |
| ------------------ | ---------------------------------------- |
| `ContentGenerator` | LLM 调用的统一接口，支持流式输出         |
| `BaseTool`         | 工具的声明式定义，包含 schema 和执行逻辑 |
| `ToolInvocation`   | 单次工具调用的封装，参数验证 + 执行      |
| `AgentClient`      | Agent 主循环，管理对话状态和历史         |
| `Turn`             | 单轮对话的事件流处理                     |
| `Config`           | 配置聚合，依赖注入容器                   |
| `ToolRegistry`     | 工具注册、发现和元数据管理               |

## 3. 分阶段开发计划

### Phase 1: 核心骨架 (1-2 周)

**目标**：实现一个可对话、能读写文件的最小 code agent

#### 3.1.1 项目结构

```
my-code-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # CLI 入口
│   ├── agent/
│   │   ├── client.ts         # Agent 主循环
│   │   ├── turn.ts           # 单轮对话处理
│   │   └── types.ts          # 核心类型定义
│   ├── tools/
│   │   ├── base.ts           # 工具基类
│   │   ├── registry.ts       # 工具注册表
│   │   ├── read-file.ts      # 读取文件
│   │   ├── write-file.ts     # 写入文件
│   │   ├── edit-file.ts      # 编辑文件
│   │   ├── shell.ts          # 执行命令
│   │   └── glob.ts           # 文件搜索
│   ├── llm/
│   │   ├── types.ts          # LLM 接口定义
│   │   ├── openai.ts         # OpenAI 兼容实现
│   │   └── stream.ts         # 流式处理工具
│   ├── config/
│   │   └── index.ts          # 配置管理
│   └── ui/
│       └── repl.ts           # 简单的 REPL 交互
└── tests/
    ├── agent.test.ts
    ├── tools.test.ts
    └── llm.test.ts
```

#### 3.1.2 核心接口定义

```typescript
// src/llm/types.ts

/** 消息角色 */
type MessageRole = 'user' | 'assistant' | 'tool' | 'system';

/** 消息内容 */
interface Message {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/** 工具调用请求 */
interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具定义 */
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

/** 流式事件 */
type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done'; finishReason: string }
  | { type: 'error'; error: Error };

/** LLM 内容生成器接口 */
interface ContentGenerator {
  /** 生成内容（流式） */
  generateStream(
    messages: Message[],
    tools: ToolDefinition[],
  ): AsyncGenerator<StreamEvent>;

  /** 生成内容（非流式） */
  generate(messages: Message[], tools: ToolDefinition[]): Promise<string>;
}
```

```typescript
// src/tools/base.ts

/** 工具执行结果 */
interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
}

/** 工具接口 */
interface Tool<TParams = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: JSONSchema;

  /** 验证参数 */
  validate(params: TParams): string | null;

  /** 执行工具 */
  execute(params: TParams): Promise<ToolResult>;
}

/** 工具基类 */
abstract class BaseTool<TParams> implements Tool<TParams> {
  constructor(
    public readonly name: string,
    public readonly description: string,
    public readonly parameters: JSONSchema,
  ) {}

  validate(params: TParams): string | null {
    // 默认使用 JSON Schema 验证
    return null;
  }

  abstract execute(params: TParams): Promise<ToolResult>;
}
```

```typescript
// src/agent/types.ts

/** 对话历史 */
interface ConversationHistory {
  messages: Message[];
  addMessage(message: Message): void;
  getMessages(): Message[];
  clear(): void;
}

/** Agent 配置 */
interface AgentConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/** Agent 事件 */
type AgentEvent =
  | { type: 'user_input'; content: string }
  | { type: 'llm_response'; content: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'tool_result'; name: string; result: ToolResult }
  | { type: 'error'; error: Error }
  | { type: 'done' };
```

#### 3.1.3 Agent 主循环

```typescript
// src/agent/client.ts

class AgentClient {
  private history: ConversationHistory;
  private tools: ToolRegistry;
  private llm: ContentGenerator;

  constructor(config: AgentConfig) {
    this.history = new ConversationHistoryImpl();
    this.tools = new ToolRegistry();
    this.llm = new OpenAIContentGenerator(config);
  }

  /** 主循环 */
  async *processUserInput(input: string): AsyncGenerator<AgentEvent> {
    // 1. 添加用户消息到历史
    this.history.addMessage({ role: 'user', content: input });

    // 2. 循环调用 LLM 直到完成
    while (true) {
      const events = this.llm.generateStream(
        this.history.getMessages(),
        this.tools.getDefinitions(),
      );

      let responseContent = '';
      const toolCalls: ToolCall[] = [];

      for await (const event of events) {
        if (event.type === 'text') {
          responseContent += event.delta;
          yield { type: 'llm_response', content: event.delta };
        } else if (event.type === 'tool_call') {
          toolCalls.push(event.toolCall);
        } else if (event.type === 'error') {
          yield { type: 'error', error: event.error };
          return;
        }
      }

      // 3. 添加 assistant 消息到历史
      this.history.addMessage({
        role: 'assistant',
        content: responseContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      // 4. 如果没有工具调用，结束循环
      if (toolCalls.length === 0) {
        yield { type: 'done' };
        break;
      }

      // 5. 执行工具调用
      for (const toolCall of toolCalls) {
        yield {
          type: 'tool_call',
          name: toolCall.name,
          args: toolCall.arguments,
        };

        const tool = this.tools.get(toolCall.name);
        const result = await tool.execute(toolCall.arguments);

        yield { type: 'tool_result', name: toolCall.name, result };

        this.history.addMessage({
          role: 'tool',
          toolCallId: toolCall.id,
          content: result.content,
        });
      }

      // 6. 继续循环，让 LLM 处理工具结果
    }
  }
}
```

#### 3.1.4 Phase 1 功能清单

| 功能            | 状态   | 说明                   |
| --------------- | ------ | ---------------------- |
| CLI 入口        | 必须   | 接收用户输入，启动对话 |
| OpenAI 兼容 API | 必须   | 支持大多数模型         |
| 对话循环        | 必须   | Agent 核心逻辑         |
| read_file 工具  | 必须   | 读取文件内容           |
| write_file 工具 | 必须   | 创建/覆盖文件          |
| edit_file 工具  | 必须   | 编辑文件（字符串替换） |
| shell 工具      | 必须   | 执行 shell 命令        |
| glob 工具       | 必须   | 文件模式匹配           |
| 历史管理        | 简化版 | 内存中保存，重启清空   |
| 错误处理        | 基础版 | 捕获并显示错误         |

#### 3.1.5 依赖清单

```json
{
  "dependencies": {
    "commander": "^12.0.0",
    "openai": "^4.0.0",
    "chalk": "^5.0.0",
    "glob": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "vitest": "^1.0.0"
  }
}
```

---

### Phase 2: 工具扩展 (2-3 周)

**目标**：扩展工具集，增加代码搜索能力，改进用户体验

#### 3.2.1 新增工具

| 工具        | 说明                           |
| ----------- | ------------------------------ |
| `grep`      | 代码内容搜索（基于 ripgrep）   |
| `lsp`       | LSP 集成（跳转定义、查找引用） |
| `web_fetch` | 获取网页内容                   |
| `ask_user`  | 向用户提问                     |

#### 3.2.2 改进项

- **历史持久化**：保存/恢复对话历史
- **工具确认机制**：危险操作需要用户确认
- **流式输出优化**：更好的 TUI 显示
- **多文件编辑**：支持批量编辑

#### 3.2.3 新增项目结构

```
src/
├── tools/
│   ├── grep.ts              # 代码搜索
│   ├── lsp/
│   │   ├── client.ts        # LSP 客户端
│   │   └── index.ts         # LSP 工具
│   ├── web-fetch.ts         # 网页获取
│   └── ask-user.ts          # 用户交互
├── storage/
│   ├── history.ts           # 历史持久化
│   └── temp.ts              # 临时文件管理
└── permission/
    └── confirmation.ts      # 权限确认系统
```

---

### Phase 3: 生产就绪 (2-4 周)

**目标**：多模型支持、上下文压缩、完整配置系统

#### 3.3.1 多模型支持

```typescript
// 模型 Provider 接口
interface ModelProvider {
  name: string;
  createGenerator(config: ModelConfig): ContentGenerator;
  getSupportedModels(): string[];
}

// 内置 Provider
-OpenAIProvider - // OpenAI 官方 API
  AnthropicProvider - // Claude API
  OllamaProvider - // 本地模型
  OpenAICompatible; // 通用的 OpenAI 兼容 API
```

#### 3.3.2 上下文压缩

```typescript
interface CompressionService {
  shouldCompress(history: Message[]): boolean;
  compress(history: Message[]): Promise<Message[]>;
}

// 压缩策略
- Token 阈值检测
- 保留最近 N 轮对话
- 模型生成摘要
```

#### 3.3.3 完整配置系统

```
~/.my-code-agent/
├── config.json        # 全局配置
├── .env               # API Keys
└── history/
    └── session-*.json # 会话历史
```

#### 3.3.4 新增项目结构

```
src/
├── llm/
│   ├── providers/
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── ollama.ts
│   └── model-registry.ts
├── compression/
│   ├── service.ts
│   └── summarizer.ts
├── config/
│   ├── loader.ts
│   └── schema.ts
└── ui/
    ├── ink-app.tsx    # Ink TUI
    └── components/
```

---

## 4. 技术决策记录

### 4.1 为什么选择 OpenAI SDK 作为基础？

- **兼容性最好**：大多数 LLM API 都兼容 OpenAI 格式
- **生态成熟**：文档完善，社区活跃
- **易于扩展**：可以轻松适配其他 API

### 4.2 为什么不一开始就用 Ink？

- Phase 1 专注于核心逻辑
- 简单的 readline 接口足够验证功能
- Phase 2 再引入 TUI 框架

### 4.3 为什么工具设计采用类而非函数？

- 便于统一管理 schema 和执行逻辑
- 支持依赖注入（如 Config）
- 便于测试和 mock

---

## 5. 风险与缓解

| 风险         | 缓解措施                                |
| ------------ | --------------------------------------- |
| LLM API 变更 | 使用适配器模式隔离 API 细节             |
| 工具执行安全 | Phase 2 引入确认机制                    |
| 上下文爆炸   | Phase 3 实现压缩策略                    |
| 跨平台兼容   | 使用 Node.js 原生 API，避免平台特定代码 |

---

## 6. 参考资源

- [qwen-code 源码](https://github.com/QwenLM/qwen-code)
- [Claude Code 文档](https://docs.anthropic.com/claude-code)
- [OpenAI API 文档](https://platform.openai.com/docs)
- [Ink 文档](https://github.com/vadimdemedes/ink)

---

## 7. 下一步

完成设计文档后，可以按照 Phase 1 的规划开始实现：

1. 初始化项目结构
2. 实现 LLM 接口和 OpenAI Provider
3. 实现工具基类和核心工具
4. 实现 Agent 主循环
5. 实现 CLI 入口
6. 编写测试

每个步骤完成后，都可以进行手动测试验证功能。

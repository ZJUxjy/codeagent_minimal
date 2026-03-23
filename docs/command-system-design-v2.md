# lop_minimal 命令系统设计文档 v2

> 基于现有代码的简化版命令系统

## 1. 现有代码分析

### 1.1 已有类型和服务

```typescript
// src/protocol/types.ts - 配置类型
interface LopConfig {
  provider?: "openai" | "anthropic" | "openrouter" | "minimax"
  model?: string
  apiKey?: string
  baseURL?: string
  debug?: boolean
}

// src/client/index.ts - 客户端
class Client {
  initialize(): Promise<void>
  onEvent(handler: (event: ClientEvent) => void): void
  chat(message: string, cwd?: string): Promise<void>
  clear(): Promise<void>
  close(): void
}

// src/tui/types.ts - 消息类型
type Message = UserMessage | AssistantMessage | ToolMessage
```

### 1.2 App 组件中的状态

```typescript
// App.tsx 中管理
const [messages, setMessages] = useState<Message[]>([])
const [isLoading, setIsLoading] = useState(false)
const client: Client | null
```

## 2. 简化设计

### 2.1 核心类型 (`src/commands/types.ts`)

```typescript
/** 命令类型 */
export enum CommandKind {
  BUILT_IN = 'built-in',
}

/** 命令上下文 - 传递给命令的上下文 */
export interface CommandContext {
  // 服务
  client: {
    chat: (message: string) => Promise<void>;
    clear: () => Promise<void>;
  } | null;

  config: {
    provider: string;
    model: string;
    cwd: string;
  };

  // UI 操作
  ui: {
    addMessage: (content: string, role?: 'user' | 'assistant') => void;
    addSystemMessage: (content: string, isError?: boolean) => void;
    clearMessages: () => void;
    setLoading: (loading: boolean) => void;
  };

  // 退出
  quit: () => void;
}

/** 命令返回类型 */
export type SlashCommandActionReturn =
  | { type: 'message'; content: string; isError?: boolean }
  | { type: 'quit' }
  | { type: 'submit_prompt'; content: string }
  | void;

/** Slash 命令接口 */
export interface SlashCommand {
  name: string;
  altNames?: string[];
  description: string;
  hidden?: boolean;
  kind: CommandKind;
  action?: (
    context: CommandContext,
    args: string
  ) => SlashCommandActionReturn | Promise<SlashCommandActionReturn>;
  subCommands?: SlashCommand[];
}
```

### 2.2 目录结构

```
src/
├── commands/
│   ├── types.ts              # 核心类型定义
│   ├── index.ts              # 命令导出
│   ├── builtin/              # 内置命令
│   │   ├── helpCommand.ts
│   │   ├── clearCommand.ts
│   │   ├── quitCommand.ts
│   │   ├── statsCommand.ts
│   │   └── modelCommand.ts
│   └── CommandRegistry.ts    # 命令注册表
├── tui/
│   ├── hooks/
│   │   └── useCommandProcessor.ts  # 命令处理 Hook
│   ├── components/
│   │   └── HelpDialog.tsx    # 帮助显示组件
│   └── utils/
│       └── commandParser.ts  # 命令解析
```

## 3. 实现步骤

### Step 1: 创建类型定义
创建 `src/commands/types.ts`

### Step 2: 创建命令注册表
创建 `src/commands/CommandRegistry.ts`
- 管理所有命令
- 提供命令查找功能

### Step 3: 实现命令解析
创建 `src/tui/utils/commandParser.ts`
- 解析 `/command args` 格式
- 支持子命令

### Step 4: 实现内置命令
创建 `src/commands/builtin/` 目录下的命令文件

### Step 5: 实现命令处理 Hook
创建 `src/tui/hooks/useCommandProcessor.ts`
- 集成到 App 组件

### Step 6: 实现 Help 组件
创建 `src/tui/components/HelpDialog.tsx`

### Step 7: 集成到 App 和 InputBox
修改 `App.tsx` 和 `InputBox.tsx`

## 4. 内置命令列表

| 命令 | 别名 | 描述 |
|------|------|------|
| `/help` | `?` | 显示帮助 |
| `/clear` | `reset`, `new` | 清空对话 |
| `/quit` | `exit`, `q` | 退出程序 |
| `/stats` | `usage` | 显示会话统计 |
| `/model` | - | 查看/切换模型 |

## 5. 与现有代码的集成点

### 5.1 App.tsx 修改

```typescript
// 添加命令处理器
const { processCommand, commands } = useCommandProcessor({
  client,
  config: clientOptions,
  addMessage,
  clearMessages,
  quit: () => process.exit(0),
});

// 修改 handleSubmit
const handleSubmit = async (input: string) => {
  // 检查是否是命令
  if (input.startsWith('/')) {
    const result = await processCommand(input);
    if (result?.type === 'submit_prompt') {
      // 继续作为普通消息处理
      input = result.content;
    } else {
      return; // 命令已处理
    }
  }
  // 原有的消息处理逻辑...
};
```

### 5.2 InputBox.tsx 修改

- 保持现有功能
- 添加命令历史支持

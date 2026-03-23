# lop_minimal TUI 设计文档

> 基于 Ink + React 的终端用户界面设计
> 方案：渐进式集成

## 1. 概述

### 1.1 目标

将现有的 readline REPL 替换为功能完整的 TUI，支持：
- 流式输出显示
- 工具调用可视化
- 丰富的交互体验
- 可扩展的组件架构

### 1.2 设计原则

1. **最小依赖**：只引入必要的 npm 包
2. **渐进增强**：从简单开始，逐步添加功能
3. **事件驱动**：复用现有的 Client 事件系统
4. **组件化**：每个 UI 元素都是独立的 React 组件

## 2. 技术选型

| 包 | 版本 | 用途 |
|---|---|---|
| `ink` | ^4.0.0 | React 风格的终端 UI 框架 |
| `react` | ^18.0.0 | UI 组件化（Ink 依赖） |
| `chalk` | ^5.0.0 | 终端颜色和样式 |
| `cli-width` | ^4.0.0 | 获取终端宽度 |

### 依赖安装

```bash
npm install ink react chalk cli-width
npm install -D @types/react
```

## 3. 架构设计

### 3.1 目录结构

```
src/
├── index.ts              # CLI 入口（修改后）
├── tui/
│   ├── index.tsx         # TUI 应用入口
│   ├── App.tsx           # 主应用组件
│   ├── components/
│   │   ├── Header.tsx    # 顶部信息栏
│   │   ├── MessageList.tsx   # 消息列表
│   │   ├── MessageItem.tsx   # 单条消息
│   │   ├── InputBox.tsx      # 输入框
│   │   ├── LoadingIndicator.tsx  # 加载指示器
│   │   └── ToolCallDisplay.tsx    # 工具调用显示
│   ├── contexts/
│   │   ├── AppContext.tsx    # 全局状态
│   │   └── ThemeContext.tsx  # 主题配置
│   ├── hooks/
│   │   ├── useClient.ts      # Client 集成
│   │   ├── useInput.ts       # 输入处理
│   │   └── useHistory.ts     # 历史记录
│   └── utils/
│       ├── colors.ts         # 颜色配置
│       └── format.ts         # 格式化工具
├── client/
│   └── index.ts          # 现有 Client（无需修改）
└── ...
```

### 3.2 组件架构

```
┌─────────────────────────────────────────────────────────────┐
│                        App.tsx                              │
│  ┌───────────────────────────────────────────────────────┐ │
│  │                    AppProvider                         │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │                   Header                        │  │ │
│  │  │  lop_minimal v0.1.0 | Model: gpt-4o             │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │                 MessageList                     │  │ │
│  │  │  ┌─────────────────────────────────────────┐    │  │ │
│  │  │  │ MessageItem (user)                      │    │  │ │
│  │  │  │ > 你好                                  │    │  │ │
│  │  │  └─────────────────────────────────────────┘    │  │ │
│  │  │  ┌─────────────────────────────────────────┐    │  │ │
│  │  │  │ MessageItem (assistant)                 │    │  │ │
│  │  │  │ 你好！有什么我可以帮助你的吗？           │    │  │ │
│  │  │  └─────────────────────────────────────────┘    │  │ │
│  │  │  ┌─────────────────────────────────────────┐    │  │ │
│  │  │  │ ToolCallDisplay                         │    │  │ │
│  │  │  │ 🔧 read_file({"path": "src/index.ts"})  │    │  │ │
│  │  │  │ ✅ Successfully read 50 lines           │    │  │ │
│  │  │  └─────────────────────────────────────────┘    │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │              LoadingIndicator                   │  │ │
│  │  │  ⠋ Thinking...                                  │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  │  ┌─────────────────────────────────────────────────┐  │ │
│  │  │                 InputBox                        │  │ │
│  │  │  > _                                            │  │ │
│  │  └─────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 数据流

```
┌──────────────┐     JSON-RPC      ┌──────────────┐
│   Server     │ ◄───────────────► │    Client    │
│  (Agent)     │                   │  (现有代码)   │
└──────────────┘                   └──────┬───────┘
                                          │
                                          │ 事件
                                          ▼
                                   ┌──────────────┐
                                   │  useClient   │
                                   │    Hook      │
                                   └──────┬───────┘
                                          │
                                          │ 状态更新
                                          ▼
                                   ┌──────────────┐
                                   │  AppContext  │
                                   │  (messages,  │
                                   │   isLoading) │
                                   └──────┬───────┘
                                          │
                                          │ React 渲染
                                          ▼
                                   ┌──────────────┐
                                   │   UI 组件    │
                                   └──────────────┘
```

## 4. 核心接口定义

### 4.1 消息类型

```typescript
// src/tui/types.ts

/** 消息角色 */
type MessageRole = 'user' | 'assistant' | 'tool';

/** 基础消息 */
interface BaseMessage {
  id: string;
  role: MessageRole;
  timestamp: number;
}

/** 用户消息 */
interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

/** 助手消息 */
interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  isStreaming?: boolean;
}

/** 工具调用 */
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
}

/** 工具消息 */
interface ToolMessage extends BaseMessage {
  role: 'tool';
  toolCall: ToolCall;
}

/** 联合类型 */
type Message = UserMessage | AssistantMessage | ToolMessage;
```

### 4.2 应用状态

```typescript
// src/tui/types.ts

interface AppState {
  // 消息
  messages: Message[];

  // 加载状态
  isLoading: boolean;
  loadingText?: string;

  // 输入状态
  inputValue: string;
  inputHistory: string[];
  historyIndex: number;

  // 配置
  model: string;
  provider: string;
  cwd: string;
}

interface AppActions {
  // 消息操作
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
  updateMessage: (id: string, update: Partial<Message>) => void;

  // 输入操作
  setInputValue: (value: string) => void;
  submitInput: () => void;

  // 历史操作
  navigateHistory: (direction: 'up' | 'down') => void;

  // 其他
  clearMessages: () => void;
  setLoading: (loading: boolean, text?: string) => void;
}
```

## 5. 分阶段实现

### Phase 1: 基础骨架 (1-2 天)

#### 5.1.1 目标

- 替换 readline 为 Ink TUI
- 基本的消息显示和输入
- 流式输出支持

#### 5.1.2 核心文件

##### App.tsx - 主应用组件

```tsx
// src/tui/App.tsx
import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Header } from './components/Header';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';
import { LoadingIndicator } from './components/LoadingIndicator';
import { useClient } from './hooks/useClient';
import type { Message } from './types';

interface AppProps {
  clientOptions: {
    provider?: string;
    model?: string;
    apiKey?: string;
    baseURL?: string;
    cwd?: string;
  };
}

export const App: React.FC<AppProps> = ({ clientOptions }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');

  const { client, isReady } = useClient(clientOptions);

  // 处理 Client 事件
  useEffect(() => {
    if (!client) return;

    client.onEvent((event) => {
      switch (event.type) {
        case 'content':
          setStreamingContent(prev => prev + event.delta);
          break;

        case 'tool_call':
          setMessages(prev => [...prev, {
            id: `tool-${Date.now()}`,
            role: 'tool',
            timestamp: Date.now(),
            toolCall: {
              id: event.id,
              name: event.name,
              args: event.args,
              status: 'running',
            },
          }]);
          break;

        case 'tool_result':
          // 更新工具调用状态
          setMessages(prev => prev.map(msg => {
            if (msg.role === 'tool' && msg.toolCall.id === event.id) {
              return {
                ...msg,
                toolCall: {
                  ...msg.toolCall,
                  status: event.isError ? 'error' : 'success',
                  result: event.content,
                },
              };
            }
            return msg;
          }));
          break;

        case 'done':
          // 将流式内容转为消息
          if (streamingContent) {
            setMessages(prev => [...prev, {
              id: `assistant-${Date.now()}`,
              role: 'assistant',
              content: streamingContent,
              timestamp: Date.now(),
            }]);
            setStreamingContent('');
          }
          setIsLoading(false);
          break;
      }
    });
  }, [client, streamingContent]);

  // 提交输入
  const handleSubmit = useCallback(async (input: string) => {
    if (!input.trim() || !client) return;

    // 添加用户消息
    setMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }]);

    setIsLoading(true);

    try {
      await client.chat(input, clientOptions.cwd);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: `Error: ${error}`,
        timestamp: Date.now(),
      }]);
      setIsLoading(false);
    }
  }, [client, clientOptions.cwd]);

  // 清空历史
  const handleClear = useCallback(async () => {
    if (client) {
      await client.clear();
      setMessages([]);
    }
  }, [client]);

  return (
    <Box flexDirection="column" padding={1}>
      <Header
        model={clientOptions.model ?? 'gpt-4o'}
        provider={clientOptions.provider ?? 'openai'}
      />

      <MessageList
        messages={messages}
        streamingContent={streamingContent}
      />

      {isLoading && <LoadingIndicator />}

      <InputBox
        onSubmit={handleSubmit}
        onClear={handleClear}
        disabled={isLoading || !isReady}
      />
    </Box>
  );
};
```

##### useClient.ts - Client 集成 Hook

```tsx
// src/tui/hooks/useClient.ts
import { useState, useEffect, useRef } from 'react';
import { Client, type ClientOptions } from '../../client/index.js';

export function useClient(options: ClientOptions) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<Client | null>(null);

  useEffect(() => {
    const client = new Client(options);

    client.initialize()
      .then(() => {
        clientRef.current = client;
        setIsReady(true);
      })
      .catch((err) => {
        setError(err.message);
      });

    return () => {
      client.close();
    };
  }, []);

  return {
    client: clientRef.current,
    isReady,
    error,
  };
}
```

##### MessageList.tsx - 消息列表

```tsx
// src/tui/components/MessageList.tsx
import React from 'react';
import { Box, Text, Static } from 'ink';
import { MessageItem } from './MessageItem';
import type { Message } from '../types';

interface MessageListProps {
  messages: Message[];
  streamingContent: string;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  streamingContent,
}) => {
  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* 静态历史消息 */}
      <Static items={messages}>
        {(message) => (
          <MessageItem key={message.id} message={message} />
        )}
      </Static>

      {/* 流式输出 */}
      {streamingContent && (
        <Box marginTop={1}>
          <Text color="cyan">{streamingContent}</Text>
        </Box>
      )}
    </Box>
  );
};
```

##### MessageItem.tsx - 单条消息

```tsx
// src/tui/components/MessageItem.tsx
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { Message } from '../types';

interface MessageItemProps {
  message: Message;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
  if (message.role === 'user') {
    return (
      <Box marginTop={1}>
        <Text bold color="green">{'> '}</Text>
        <Text>{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'assistant') {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color="cyan">{message.content}</Text>
      </Box>
    );
  }

  if (message.role === 'tool') {
    const { toolCall } = message;
    const icon = toolCall.status === 'success' ? '✅' :
                 toolCall.status === 'error' ? '❌' : '🔧';

    return (
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {icon} {toolCall.name}({JSON.stringify(toolCall.args)})
        </Text>
        {toolCall.result && (
          <Text dimColor>
            {toolCall.result.length > 200
              ? toolCall.result.slice(0, 200) + '...'
              : toolCall.result}
          </Text>
        )}
      </Box>
    );
  }

  return null;
};
```

##### InputBox.tsx - 输入框

```tsx
// src/tui/components/InputBox.tsx
import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
  onSubmit: (value: string) => void;
  onClear: () => void;
  disabled?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  onSubmit,
  onClear,
  disabled,
}) => {
  const [value, setValue] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // 处理键盘输入
  useInput((input, key) => {
    if (disabled) return;

    // 上下箭头浏览历史
    if (key.upArrow) {
      if (historyIndex < history.length - 1) {
        const newIndex = historyIndex + 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] ?? '');
      }
    } else if (key.downArrow) {
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setValue(history[history.length - 1 - newIndex] ?? '');
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setValue('');
      }
    }
  });

  const handleSubmit = (submitValue: string) => {
    if (!submitValue.trim()) return;

    // 处理命令
    if (submitValue === '/clear') {
      onClear();
      setValue('');
      return;
    }

    // 添加到历史
    setHistory(prev => [...prev, submitValue]);
    setHistoryIndex(-1);

    // 提交
    onSubmit(submitValue);
    setValue('');
  };

  return (
    <Box marginTop={1}>
      <Text bold color="blue">{disabled ? '...' : '>'} </Text>
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={disabled ? 'Waiting for response...' : 'Type a message...'}
        showCursor={!disabled}
      />
    </Box>
  );
};
```

##### Header.tsx - 顶部信息栏

```tsx
// src/tui/components/Header.tsx
import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  model: string;
  provider: string;
}

export const Header: React.FC<HeaderProps> = ({ model, provider }) => {
  return (
    <Box marginBottom={1}>
      <Text bold color="magenta">lop_minimal</Text>
      <Text dimColor> v0.1.0 | </Text>
      <Text dimColor>{provider}/{model}</Text>
    </Box>
  );
};
```

##### LoadingIndicator.tsx - 加载指示器

```tsx
// src/tui/components/LoadingIndicator.tsx
import React, { useState, useEffect } from 'react';
import { Text } from 'ink';

const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export const LoadingIndicator: React.FC = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(prev => (prev + 1) % frames.length);
    }, 80);

    return () => clearInterval(timer);
  }, []);

  return (
    <Text dimColor>
      {frames[frame]} Thinking...
    </Text>
  );
};
```

##### 入口文件

```tsx
// src/tui/index.tsx
import React from 'react';
import { render } from 'ink';
import { App } from './App.js';
import type { ClientOptions } from '../client/index.js';

export function startTUI(options: ClientOptions) {
  render(<App clientOptions={options} />);
}
```

##### 修改后的 CLI 入口

```typescript
// src/index.ts (修改后)
#!/usr/bin/env node
import { startTUI } from './tui/index.js';
import { loadConfig } from './config.js';
import type { ClientOptions } from './client/index.js';

async function main() {
  const fileConfig = loadConfig();

  // 解析命令行参数
  const args = process.argv.slice(2);
  const cliOptions: Partial<ClientOptions> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-p' || arg === '--provider') {
      cliOptions.provider = args[++i];
    } else if (arg === '-m' || arg === '--model') {
      cliOptions.model = args[++i];
    } else if (arg === '-d' || arg === '--directory') {
      cliOptions.cwd = args[++i];
    }
  }

  const options: ClientOptions = {
    provider: cliOptions.provider ?? fileConfig.provider,
    model: cliOptions.model ?? fileConfig.model,
    apiKey: fileConfig.apiKey,
    baseURL: fileConfig.baseURL,
    cwd: cliOptions.cwd,
  };

  // 启动 TUI
  startTUI(options);
}

main().catch(console.error);
```

---

### Phase 2: 功能完善 (2-3 天)

#### 5.2.1 目标

- 工具调用可视化增强
- 颜色主题
- 快捷键支持
- 错误处理美化

#### 5.2.2 新增组件

##### ThemeContext.tsx - 主题配置

```tsx
// src/tui/contexts/ThemeContext.tsx
import React, { createContext, useContext } from 'react';
import chalk from 'chalk';

export interface Theme {
  // 消息颜色
  userMessage: chalk.Chalk;
  assistantMessage: chalk.Chalk;
  toolCall: chalk.Chalk;
  toolSuccess: chalk.Chalk;
  toolError: chalk.Chalk;

  // UI 颜色
  header: chalk.Chalk;
  input: chalk.Chalk;
  loading: chalk.Chalk;
}

const defaultTheme: Theme = {
  userMessage: chalk.green,
  assistantMessage: chalk.cyan,
  toolCall: chalk.yellow,
  toolSuccess: chalk.green,
  toolError: chalk.red,
  header: chalk.magenta.bold,
  input: chalk.blue,
  loading: chalk.gray,
};

const ThemeContext = createContext<Theme>(defaultTheme);

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  return (
    <ThemeContext.Provider value={defaultTheme}>
      {children}
    </ThemeContext.Provider>
  );
};
```

##### ShortcutsBar.tsx - 快捷键提示

```tsx
// src/tui/components/ShortcutsBar.tsx
import React from 'react';
import { Box, Text } from 'ink';

export const ShortcutsBar: React.FC = () => {
  return (
    <Box marginTop={1}>
      <Text dimColor>
        [Ctrl+C] Exit | [Ctrl+L] Clear | [↑↓] History | [/help] Commands
      </Text>
    </Box>
  );
};
```

##### ErrorDisplay.tsx - 错误显示

```tsx
// src/tui/components/ErrorDisplay.tsx
import React from 'react';
import { Box, Text } from 'ink';

interface ErrorDisplayProps {
  error: string;
  hint?: string;
}

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({ error, hint }) => {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="red"
      paddingX={1}
    >
      <Text color="red" bold>❌ Error</Text>
      <Text>{error}</Text>
      {hint && <Text dimColor>💡 {hint}</Text>}
    </Box>
  );
};
```

##### 增强的 ToolCallDisplay.tsx

```tsx
// src/tui/components/ToolCallDisplay.tsx
import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

interface ToolCallDisplayProps {
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: string;
  duration?: number;
}

export const ToolCallDisplay: React.FC<ToolCallDisplayProps> = ({
  name,
  args,
  status,
  result,
  duration,
}) => {
  const statusIcons = {
    pending: '⏳',
    running: '🔄',
    success: '✅',
    error: '❌',
  };

  const statusColors = {
    pending: 'yellow',
    running: 'yellow',
    success: 'green',
    error: 'red',
  } as const;

  // 格式化参数显示
  const argsStr = Object.entries(args)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : JSON.stringify(v)}`)
    .join(', ');

  // 格式化结果显示
  const resultPreview = result
    ? result.length > 150
      ? result.slice(0, 150) + '...'
      : result
    : null;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderLeft
      paddingLeft={1}
      marginY={1}
    >
      <Box>
        <Text>{statusIcons[status]} </Text>
        <Text bold color="yellow">{name}</Text>
        <Text dimColor>({argsStr})</Text>
        {duration && <Text dimColor> [{duration}ms]</Text>}
      </Box>

      {status === 'running' && (
        <Text dimColor>  Running...</Text>
      )}

      {resultPreview && status !== 'running' && (
        <Box flexDirection="column">
          <Text dimColor>  └─ </Text>
          <Text color={statusColors[status]}>
            {resultPreview.split('\n').map((line, i) => (
              <Text key={i}>    {line}{'\n'}</Text>
            ))}
          </Text>
        </Box>
      )}
    </Box>
  );
};
```

---

### Phase 3: 高级功能 (3-5 天)

#### 5.3.1 目标

- 多行输入支持
- 自动补全
- Markdown 渲染
- 内置帮助系统

#### 5.3.2 高级组件

##### MultiLineInput.tsx - 多行输入

```tsx
// src/tui/components/MultiLineInput.tsx
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

interface MultiLineInputProps {
  onSubmit: (value: string) => void;
  onClear: () => void;
  disabled?: boolean;
  placeholder?: string;
}

export const MultiLineInput: React.FC<MultiLineInputProps> = ({
  onSubmit,
  onClear,
  disabled,
  placeholder = 'Type a message...',
}) => {
  const [lines, setLines] = useState<string[]>(['']);
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [isMultiline, setIsMultiline] = useState(false);
  const { exit } = useApp();

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.return) {
        if (isMultiline) {
          // 多行模式：换行
          setLines(prev => {
            const newLines = [...prev];
            const currentLine = newLines[cursorLine];
            const beforeCursor = currentLine.slice(0, cursorCol);
            const afterCursor = currentLine.slice(cursorCol);
            newLines[cursorLine] = beforeCursor;
            newLines.splice(cursorLine + 1, 0, afterCursor);
            return newLines;
          });
          setCursorLine(prev => prev + 1);
          setCursorCol(0);
        } else {
          // 单行模式：提交
          const content = lines.join('\n');
          if (content.trim()) {
            onSubmit(content);
            setLines(['']);
            setCursorLine(0);
            setCursorCol(0);
          }
        }
        return;
      }

      if (key.escape) {
        if (isMultiline) {
          setIsMultiline(false);
        }
        return;
      }

      if (input === '\x01' /* Ctrl+A */) {
        setIsMultiline(true);
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorCol > 0) {
          setLines(prev => {
            const newLines = [...prev];
            newLines[cursorLine] =
              newLines[cursorLine].slice(0, cursorCol - 1) +
              newLines[cursorLine].slice(cursorCol);
            return newLines;
          });
          setCursorCol(prev => prev - 1);
        } else if (cursorLine > 0) {
          // 合并到上一行
          setLines(prev => {
            const newLines = [...prev];
            const prevLineLength = newLines[cursorLine - 1].length;
            newLines[cursorLine - 1] += newLines[cursorLine];
            newLines.splice(cursorLine, 1);
            return newLines;
          });
          setCursorLine(prev => prev - 1);
          setCursorCol(lines[cursorLine - 1]?.length ?? 0);
        }
        return;
      }

      if (key.leftArrow) {
        if (cursorCol > 0) {
          setCursorCol(prev => prev - 1);
        } else if (cursorLine > 0) {
          setCursorLine(prev => prev - 1);
          setCursorCol(lines[cursorLine - 1]?.length ?? 0);
        }
        return;
      }

      if (key.rightArrow) {
        const currentLineLength = lines[cursorLine]?.length ?? 0;
        if (cursorCol < currentLineLength) {
          setCursorCol(prev => prev + 1);
        } else if (cursorLine < lines.length - 1) {
          setCursorLine(prev => prev + 1);
          setCursorCol(0);
        }
        return;
      }

      if (key.upArrow) {
        if (cursorLine > 0) {
          setCursorLine(prev => prev - 1);
          setCursorCol(Math.min(cursorCol, lines[cursorLine - 1]?.length ?? 0));
        }
        return;
      }

      if (key.downArrow) {
        if (cursorLine < lines.length - 1) {
          setCursorLine(prev => prev + 1);
          setCursorCol(Math.min(cursorCol, lines[cursorLine + 1]?.length ?? 0));
        }
        return;
      }

      // 普通字符输入
      if (input && !key.ctrl && !key.meta) {
        setLines(prev => {
          const newLines = [...prev];
          newLines[cursorLine] =
            newLines[cursorLine].slice(0, cursorCol) +
            input +
            newLines[cursorLine].slice(cursorCol);
          return newLines;
        });
        setCursorCol(prev => prev + 1);
      }
    },
    { isActive: !disabled }
  );

  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, i) => (
        <Box key={i}>
          {isMultiline && (
            <Text dimColor>{String(i + 1).padStart(2)}│</Text>
          )}
          <Text bold color="blue">
            {i === cursorLine ? (disabled ? '...' : '>') : '  '}
          </Text>
          <Text>
            {line}
            {i === cursorLine && !disabled && (
              <Text backgroundColor="white" color="black"> </Text>
            )}
          </Text>
        </Box>
      ))}
      {isMultiline && (
        <Text dimColor>
          [Ctrl+A] Toggle multiline | [Enter] New line | [Esc] Single line
        </Text>
      )}
    </Box>
  );
};
```

##### AutoComplete.tsx - 自动补全

```tsx
// src/tui/components/AutoComplete.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';

interface Suggestion {
  label: string;
  description?: string;
  value: string;
}

interface AutoCompleteProps {
  input: string;
  cursorPosition: number;
  onSelect: (value: string) => void;
}

// 命令补全
const COMMANDS: Suggestion[] = [
  { label: '/clear', description: 'Clear conversation history', value: '/clear' },
  { label: '/help', description: 'Show help', value: '/help' },
  { label: '/model', description: 'Change model', value: '/model' },
  { label: '/exit', description: 'Exit application', value: '/exit' },
];

export const AutoComplete: React.FC<AutoCompleteProps> = ({
  input,
  cursorPosition,
  onSelect,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 获取当前输入的单词
  const currentWord = useMemo(() => {
    const beforeCursor = input.slice(0, cursorPosition);
    const words = beforeCursor.split(/\s+/);
    return words[words.length - 1] ?? '';
  }, [input, cursorPosition]);

  // 过滤建议
  const suggestions = useMemo(() => {
    if (!currentWord) return [];
    return COMMANDS.filter(cmd =>
      cmd.label.toLowerCase().startsWith(currentWord.toLowerCase())
    );
  }, [currentWord]);

  // 重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [suggestions.length]);

  if (suggestions.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {suggestions.map((suggestion, index) => (
        <Box key={suggestion.label}>
          <Text
            backgroundColor={index === selectedIndex ? 'blue' : undefined}
            color={index === selectedIndex ? 'white' : 'cyan'}
          >
            {suggestion.label}
          </Text>
          {suggestion.description && (
            <Text dimColor> - {suggestion.description}</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
```

##### HelpDialog.tsx - 帮助对话框

```tsx
// src/tui/components/HelpDialog.tsx
import React from 'react';
import { Box, Text } from 'ink';

export const HelpDialog: React.FC = () => {
  return (
    <Box flexDirection="column" padding={1} borderStyle="round">
      <Text bold color="cyan">lop_minimal Help</Text>
      <Text> </Text>
      <Text bold>Commands:</Text>
      <Text>  /clear    - Clear conversation history</Text>
      <Text>  /help     - Show this help</Text>
      <Text>  /model    - Change model</Text>
      <Text>  /exit     - Exit application</Text>
      <Text> </Text>
      <Text bold>Keyboard Shortcuts:</Text>
      <Text>  Ctrl+C    - Exit</Text>
      <Text>  Ctrl+L    - Clear screen</Text>
      <Text>  Ctrl+A    - Toggle multiline mode</Text>
      <Text>  ↑/↓       - Navigate history</Text>
      <Text>  Tab       - Accept suggestion</Text>
      <Text> </Text>
      <Text dimColor>Press Escape to close</Text>
    </Box>
  );
};
```

---

## 6. 依赖清单

### 6.1 Phase 1 依赖

```json
{
  "dependencies": {
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "chalk": "^5.3.0",
    "cli-width": "^4.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0"
  }
}
```

### 6.2 可选增强依赖（Phase 2-3）

```json
{
  "dependencies": {
    "ink-text-input": "^5.0.1",
    "ink-spinner": "^5.0.0",
    "ink-select-input": "^5.0.0"
  }
}
```

---

## 7. 实现步骤

### Phase 1 实现顺序

1. **安装依赖**
   ```bash
   npm install ink react chalk cli-width
   npm install -D @types/react
   ```

2. **创建目录结构**
   ```bash
   mkdir -p src/tui/components src/tui/hooks src/tui/contexts
   ```

3. **实现基础类型** (`src/tui/types.ts`)

4. **实现 useClient Hook** (`src/tui/hooks/useClient.ts`)

5. **实现组件** (按顺序)：
   - `Header.tsx`
   - `LoadingIndicator.tsx`
   - `MessageItem.tsx`
   - `MessageList.tsx`
   - `InputBox.tsx`
   - `App.tsx`

6. **创建入口** (`src/tui/index.tsx`)

7. **修改 CLI 入口** (`src/index.ts`)

8. **测试运行**
   ```bash
   npm run build
   ./dist/index.js
   ```

---

## 8. 注意事项

1. **ESM 兼容性**：项目使用 ESM，确保 `.tsx` 文件使用正确导入
2. **构建配置**：可能需要调整 `tsconfig.json` 的 JSX 配置
3. **终端兼容性**：测试不同终端的兼容性（iTerm2, Windows Terminal, VS Code）
4. **性能考虑**：大量消息时考虑虚拟化或分页

---

## 9. 后续扩展

- [ ] 主题切换支持
- [ ] Markdown 渲染
- [ ] 代码高亮
- [ ] 图片支持（终端协议）
- [ ] 会话持久化
- [ ] 多语言支持

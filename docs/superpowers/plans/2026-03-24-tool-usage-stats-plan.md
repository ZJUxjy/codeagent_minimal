# 工具使用统计功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 `/stats tools` 命令实现工具使用统计，展示调用次数、成功/失败数和平均执行时间

**Architecture:** 采用客户端计时方案，在 TUI 层面根据 tool_call 和 tool_result 事件时间差计算执行时间，通过 CommandContext 传递统计数据给命令系统

**Tech Stack:** TypeScript, React (Ink), Map 数据结构

---

## 文件结构

```
src/
├── tui/
│   ├── types.ts              # 修改 - 新增统计类型
│   ├── App.tsx               # 修改 - 新增统计状态和逻辑
│   └── hooks/
│       └── useSlashCommandProcessor.ts  # 修改 - 传递 getToolStats
├── commands/
│   ├── types.ts              # 修改 - CommandContext 新增 getToolStats
│   └── builtin/
│       └── statsCommand.ts   # 修改 - 实现统计展示
```

---

## Task 1: 添加类型定义

**Files:**
- Modify: `src/tui/types.ts`

- [ ] **Step 1: 添加工具统计相关类型**

在 `src/tui/types.ts` 末尾添加：

```typescript
/** 单个工具的统计信息 */
export interface ToolStatEntry {
    name: string
    calls: number
    success: number
    failed: number
    totalTime: number  // 毫秒
}

/** 所有工具的统计 */
export type ToolStats = Map<string, ToolStatEntry>

/** 正在执行的工具调用（用于计时） */
export interface PendingToolCall {
    id: string
    name: string
    startTime: number
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/tui/types.ts
git commit -m "feat(types): add ToolStats and PendingToolCall types"
```

---

## Task 2: 更新 CommandContext 接口

**Files:**
- Modify: `src/commands/types.ts`
- Modify: `src/tui/types.ts` (添加导入)

- [ ] **Step 1: 在 types.ts 中添加 getToolStats 方法**

修改 `src/commands/types.ts`，在 `CommandContext` 接口中添加：

```typescript
import type { Client } from '../client/index.js'
import type { LopConfig } from '../protocol/types.js'
import type { Message } from '../tui/types.js'
import type { ToolStats } from '../tui/types.js'  // 新增

/** 命令上下文 - 传递给命令的上下文 */
export interface CommandContext {
    // ... 现有字段保持不变 ...

    /** 获取工具使用统计 */
    getToolStats: () => ToolStats  // 新增
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 会有错误（因为 App.tsx 和 useSlashCommandProcessor.ts 还没实现），但类型定义本身正确

- [ ] **Step 3: Commit**

```bash
git add src/commands/types.ts
git commit -m "feat(commands): add getToolStats to CommandContext"
```

---

## Task 3: 在 App.tsx 中实现统计逻辑

**Files:**
- Modify: `src/tui/App.tsx`

- [ ] **Step 1: 导入新类型并添加统计状态**

在 `src/tui/App.tsx` 顶部导入：

```typescript
import type { Message, ToolStats, PendingToolCall } from './types.js'
```

在 `App` 组件内添加状态（在 `const [messages, setMessages]` 之后）：

```typescript
// 工具统计
const [toolStats, setToolStats] = useState<ToolStats>(new Map())
const pendingCallsRef = useRef<Map<string, PendingToolCall>>(new Map())
```

- [ ] **Step 2: 更新 handleEvent 处理 tool_call**

修改 `handleEvent` 中的 `case 'tool_call':` 部分：

```typescript
case 'tool_call':
    // 记录开始时间
    pendingCallsRef.current.set(event.id, {
        id: event.id,
        name: event.name,
        startTime: Date.now(),
    })
    setMessages(prev => [...prev, {
        id: `tool-${Date.now()}`,
        role: 'tool' as const,
        timestamp: Date.now(),
        toolCall: {
            id: event.id,
            name: event.name,
            args: event.args,
            status: 'running',
        },
    }])
    break
```

- [ ] **Step 3: 更新 handleEvent 处理 tool_result**

修改 `handleEvent` 中的 `case 'tool_result':` 部分：

```typescript
case 'tool_result':
    // 计算耗时并更新统计
    const pendingCall = pendingCallsRef.current.get(event.id)
    if (pendingCall) {
        pendingCallsRef.current.delete(event.id)
        const elapsed = Date.now() - pendingCall.startTime

        setToolStats(prev => {
            const newStats = new Map(prev)
            const existing = newStats.get(pendingCall.name) ?? {
                name: pendingCall.name,
                calls: 0,
                success: 0,
                failed: 0,
                totalTime: 0,
            }
            newStats.set(pendingCall.name, {
                name: pendingCall.name,
                calls: existing.calls + 1,
                success: existing.success + (event.isError ? 0 : 1),
                failed: existing.failed + (event.isError ? 1 : 0),
                totalTime: existing.totalTime + elapsed,
            })
            return newStats
        })
    }

    setMessages(prev => prev.map(msg => {
        if (msg.role === 'tool' && msg.toolCall.id === event.id) {
            return {
                ...msg,
                toolCall: {
                    ...msg.toolCall,
                    status: event.isError ? 'error' : 'success',
                    result: event.content,
                }
            }
        }
        return msg
    }))
    break
```

- [ ] **Step 4: 添加 getToolStats 到 uiOps**

修改 `uiOps` 对象，添加 `getToolStats` 方法：

```typescript
const uiOps = {
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => {
        // ... 现有代码不变
    },
    addSystemMessage: (content: string, isError: boolean = false) => {
        // ... 现有代码不变
    },
    clearMessages: () => setMessages([]),
    setLoading: (loading: boolean) => setIsLoading(loading),
    getToolStats: () => toolStats,  // 新增
}
```

- [ ] **Step 5: 更新 useSlashCommandProcessor 调用**

修改 `useSlashCommandProcessor` 调用，传递 `getToolStats`：

```typescript
const { registry, processInput } = useSlashCommandProcessor({
    client,
    config,
    ui: uiOps,
    quit: exit,
})
```

- [ ] **Step 6: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 仍有错误（useSlashCommandProcessor 类型不匹配）

- [ ] **Step 7: Commit**

```bash
git add src/tui/App.tsx
git commit -m "feat(tui): add tool usage statistics tracking in App"
```

---

## Task 4: 更新 useSlashCommandProcessor Hook

**Files:**
- Modify: `src/tui/hooks/useSlashCommandProcessor.ts`

- [ ] **Step 1: 更新 UseSlashCommandProcessorOptions 接口**

修改 `ui` 对象类型，添加 `getToolStats`：

```typescript
import type { Message, ToolStats } from '../types.js'  // 添加 ToolStats 导入

export interface UseSlashCommandProcessorOptions {
    client: Client | null
    config: LopConfig & { cwd: string }

    ui: {
        addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
        addSystemMessage: (content: string, isError?: boolean) => void
        clearMessages: () => void
        setLoading: (loading: boolean) => void
        getToolStats: () => ToolStats  // 新增
    }

    quit: () => void
}
```

- [ ] **Step 2: 在 CommandContext 中传递 getToolStats**

修改构建 `context` 的代码：

```typescript
const context: CommandContext = {
    client,
    config,
    ui,
    getVisibleCommands: () => registry.getVisibleCommands(),
    getToolStats: ui.getToolStats,  // 新增
    quit,
}
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/tui/hooks/useSlashCommandProcessor.ts
git commit -m "feat(hooks): pass getToolStats through useSlashCommandProcessor"
```

---

## Task 5: 实现统计展示

**Files:**
- Modify: `src/commands/builtin/statsCommand.ts`

- [ ] **Step 1: 实现 /stats tools 子命令**

修改 `statsCommand.ts` 中 `tools` 子命令的 `action`：

```typescript
{
    name: 'tools',
    description: 'Show tool usage statistics',
    kind: CommandKind.BUILT_IN,
    action: (context: CommandContext): SlashCommandActionReturn => {
        const stats = context.getToolStats()

        if (stats.size === 0) {
            return {
                type: 'message',
                content: '📊 Tool Usage Statistics\n\nNo tool calls in this session.',
            }
        }

        // 计算总计
        let totalCalls = 0
        let totalSuccess = 0
        let totalFailed = 0
        let totalTime = 0

        const entries: Array<{ name: string; calls: number; success: number; failed: number; avgTime: number }> = []

        stats.forEach((entry) => {
            totalCalls += entry.calls
            totalSuccess += entry.success
            totalFailed += entry.failed
            totalTime += entry.totalTime

            entries.push({
                name: entry.name,
                calls: entry.calls,
                success: entry.success,
                failed: entry.failed,
                avgTime: Math.round(entry.totalTime / entry.calls),
            })
        })

        // 按调用次数排序
        entries.sort((a, b) => b.calls - a.calls)

        // 构建表格
        const lines = [
            '📊 Tool Usage Statistics',
            '',
            'Tool          Calls  Success  Failed  Avg Time',
            '─'.repeat(44),
        ]

        for (const entry of entries) {
            lines.push(
                `${entry.name.padEnd(12)} ${String(entry.calls).padStart(5)}  ${String(entry.success).padStart(7)}  ${String(entry.failed).padStart(6)}  ${String(entry.avgTime).padStart(8)}ms`
            )
        }

        lines.push('─'.repeat(44))
        lines.push(
            `${'Total'.padEnd(12)} ${String(totalCalls).padStart(5)}  ${String(totalSuccess).padStart(7)}  ${String(totalFailed).padStart(6)}  ${String(Math.round(totalTime / totalCalls)).padStart(8)}ms`
        )

        return {
            type: 'message',
            content: lines.join('\n'),
        }
    },
}
```

- [ ] **Step 2: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtin/statsCommand.ts
git commit -m "feat(commands): implement tool usage statistics display"
```

---

## Task 6: 集成测试

**Files:** 无新文件

- [ ] **Step 1: 构建项目**

Run: `npm run build`
Expected: 编译成功

- [ ] **Step 2: 启动应用测试**

Run: `npm run dev`

手动测试：
1. 发送消息让 LLM 调用工具（如 "读取 package.json 文件"）
2. 运行 `/stats tools` 查看统计
3. 验证调用次数、成功/失败、时间显示正确

- [ ] **Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete tool usage statistics feature"
```

---

## 验收清单

- [ ] `/stats tools` 显示工具调用统计表格
- [ ] 统计包含调用次数、成功/失败数、平均时间
- [ ] 未调用工具时显示友好提示
- [ ] TypeScript 编译无错误

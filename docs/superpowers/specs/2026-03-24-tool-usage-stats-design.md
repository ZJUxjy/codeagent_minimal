# 工具使用统计功能设计

## 概述

为 `/stats tools` 命令实现工具使用统计功能，展示每个工具的调用次数、成功/失败数和平均执行时间。

## 方案选择

采用**客户端计时方案**：在 TUI 层面根据 `tool_call` 和 `tool_result` 事件的时间差计算执行时间。

**优点**：
- 不需要修改 server 端
- 不需要修改协议
- "网络+执行"的总时间对用户同样有价值

## 数据结构

```typescript
// src/tui/types.ts

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

## 数据流

```
1. tool_call 事件到达
   → 记录到 pendingCalls Map（id → {name, startTime}）

2. tool_result 事件到达
   → 从 pendingCalls 获取开始时间
   → 计算耗时
   → 更新 toolStats Map

3. /stats tools 命令执行
   → 从 CommandContext.getToolStats() 获取统计
   → 格式化输出表格
```

## 文件修改清单

| 文件 | 改动 |
|------|------|
| `src/tui/types.ts` | 新增 `ToolStatEntry`、`ToolStats`、`PendingToolCall` 类型 |
| `src/tui/App.tsx` | 新增 `toolStats` 和 `pendingCalls` 状态，在 `handleEvent` 中更新统计 |
| `src/commands/types.ts` | `CommandContext` 新增 `getToolStats(): ToolStats` |
| `src/tui/hooks/useSlashCommandProcessor.ts` | 传递 `getToolStats` 到命令处理器 |
| `src/commands/builtin/statsCommand.ts` | 实现统计表格展示 |

## 输出格式

```
📊 Tool Usage Statistics

Tool          Calls  Success  Failed  Avg Time
─────────────────────────────────────────────
read             5       5       0     12ms
bash             3       2       1    156ms
glob             2       2       0     45ms
─────────────────────────────────────────────
Total           10       9       1     58ms
```

## 验收标准

- [ ] 执行工具后，`/stats tools` 显示正确的调用次数
- [ ] 成功/失败统计准确
- [ ] 执行时间计算正确
- [ ] 未调用任何工具时显示友好提示

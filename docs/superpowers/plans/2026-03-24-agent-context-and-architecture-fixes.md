# Agent Context and Architecture Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix critical issues preventing proper multi-turn tool execution and improve codebase architecture consistency.

**Architecture:** Centralize type definitions, Fix tool result injection into LLM context. Isolate logging channels. Add security hooks framework. Extract TUI state management.

**Tech Stack:** TypeScript, Vercel AI SDK, Zod, React/Ink

---

## Task Structure

### Task 1: Fix Tool Result Injection (P0 - Critical)

**Problem:** Tool execution results are yielded as events but never stored back into the message history. The LLM cannot see tool results in subsequent turns.

**Analysis:**
- `src/llm.ts:102` already has `maxSteps: 10` configured
- AI SDK's `streamText` CAN handle multi-step tool execution internally
- However, `agent.run()` yields events but doesn't persist tool results to `MessageStore`
- The `CoreMessage` type from Vercel AI SDK supports tool messages via `role: "tool"`

**Key Decision: Use AI SDK's built-in multi-step handling**

**Files:**
- Modify: `src/server/agent.ts`
- Modify: `src/server/store.ts`

**Implementation:**

**Option A (Recommended):** Let AI SDK handle multi-step, Store tool results for history.

The `CoreMessage` type supports:
```typescript
// Assistant message with tool calls
{ role: "assistant", content: string, toolInvocations?: ToolInvocation[] }

// Tool result message
{ role: "tool", toolCallId: string, content: string }
```

**Changes in `run()` method:**

```typescript
// In src/server/agent.ts

// Track tool calls for this assistant message
const toolCallsThisTurn: Array<{toolCallId: string; toolName: string; args: Record<string, unknown>}> = []

// In tool_call handler:
toolCallsThisTurn.push({
  toolCallId: event.id,
  toolName: event.name,
  args: event.args
})
yield { type: "tool_call", ... }

// After executeTool, store tool result:
this.store.add({
  role: "tool",
  toolCallId: event.id,
  content: result.content,
})
yield { type: "tool_result", ... }

// In done handler, store assistant message with tool invocations:
if (assistantContent || toolCallsThisTurn.length > 0) {
  this.store.add({
    role: "assistant",
    content: assistantContent,
    toolInvocations: toolCallsThisTurn.length > 0 ? toolCallsThisTurn : undefined,
  } as CoreMessage)
}
```

**Testing:**
- Create test file: `src/server/__tests__/agent-tool-context.test.ts`
- Test: tool result is stored in message history
- Test: assistant message includes toolInvocations
- Test: multi-turn conversation includes tool results
- Test: LLM receives tool results in subsequent calls via `store.getAll()`

**Verification:**
```bash
npm run build
npm test -- --grep "agent-tool-context"
```

---

### Task 2: Fix stdout Pollution (P1 - High)

**Problem:** `src/config.ts` uses `console.log()` which pollutes stdout. Server process uses stdout for JSON-RPC, so this can corrupt protocol communication.

**Files:**
- Modify: `src/config.ts`

**Implementation:**

Change line 43 and similar logging statements:

```typescript
// Before (line 43):
console.log(`Loaded config from ${path}`)

// After:
console.error(`[Config] Loaded config from ${path}`)
```

Also check lines 62 for homedir loading - same fix.

**Alternative - use debugLog:**
```typescript
import { debugLog } from "./config.js" // self-import for consistency

// Or create a dedicated logger:
function configLog(...args: unknown[]): void {
  console.error("[Config]", ...args)
}
```

**Testing:**
- Manual test: Run server mode and verify stdout contains only JSON-RPC
- Test: `npm run build && node dist/server/index.js` - send input, check output is valid JSON

**Verification:**
```bash
npm run build
# Manual verification - stdout should only contain JSON
echo '{"jsonrpc":"2.0","id":1,"method":"initialize"}' | node dist/server/index.js 2>/dev/null
```

---

### Task 3: Consolidate Provider Type (P2 - Medium)

**Problem:** Provider type is defined in two places with different values:
- `src/llm.ts:8` has `"google"`
- `src/server/agent.ts:12` is missing `"google"`
- `src/protocol/types.ts:113` (LopConfig.provider) is also missing `"google"`

**Files:**
- Modify: `src/protocol/types.ts` (add Provider type, update LopConfig)
- Modify: `src/llm.ts` (import Provider)
- Modify: `src/server/agent.ts` (import Provider)

**Implementation:**

1. Add to `src/protocol/types.ts`:
```typescript
// Add at top of file after imports
export type Provider = "openai" | "anthropic" | "openrouter" | "minimax" | "google"
```

2. Update `LopConfig` in `src/protocol/types.ts`:
```typescript
export interface LopConfig {
    provider?: Provider  // instead of inline union
    // ...
}
```

3. Update `src/llm.ts`:
```typescript
// Remove line 8, add import:
import type { Provider } from "./protocol/types.js"
```

4. Update `src/server/agent.ts`:
```typescript
// Remove provider type from AgentConfig, add import:
import type { Provider } from "../protocol/types.js"

export interface AgentConfig {
  provider: Provider  // instead of inline union
  // ...
}
```

**Testing:**
- Verify TypeScript compilation succeeds with google provider
- Test config loading with google provider

**Verification:**
```bash
npm run build
# Should compile without errors
```

---

### Task 4: Add Security Hook Implementation (P1 - High)

**Problem:** Security hooks exist but are not implemented. Need permission policies, dangerous command confirmation.

**Files:**
- Create: `src/server/security/policy.ts`
- Create: `src/server/security/__tests__/policy.test.ts`
- Modify: `src/server/agent.ts` (integrate policy)
- Modify: `src/server/tools/bash.ts` (add dangerous command list)

**Implementation:**

1. Create `src/server/security/policy.ts`:
```typescript
export type PermissionLevel = "allow" | "ask" | "deny"

export interface ToolPolicy {
  toolName: string
  permission: PermissionLevel
  patterns?: string[]  // e.g., dangerous commands for bash
}

export const DANGEROUS_BASH_COMMANDS = [
  // Filesystem destruction
  "rm", "rmdir", "shred",
  // Disk operations
  "dd", "mkfs", "fdisk", "parted", "format",
  // System power
  "shutdown", "reboot", "poweroff", "halt",
  // Permission changes
  "chmod", "chown", "chgrp",
  // Network operations (potentially dangerous)
  "curl", "wget", "nc", "netcat",
  // Code execution
  "eval", "exec", "source",
  // Package managers (can install malicious packages)
  "npm", "yarn", "pnpm", "pip", "pip3",
  // Git force operations
  "git push --force", "git push -f", "git reset --hard",
]

export function evaluateToolPolicy(
  toolName: string,
  args: Record<string, unknown>,
  policies: ToolPolicy[]
): PermissionLevel {
  // Check explicit policies first
  const policy = policies.find(p => p.toolName === toolName)
  if (policy) return policy.permission

  // Default dangerous operations to "ask"
  if (toolName === "bash") {
    const commandStr = String(args.command || "")
    // Extract base command (first word, handle sudo)
    const baseCommand = commandStr.split(/\s+/)[0] === "sudo"
      ? commandStr.split(/\s+/)[1]
      : commandStr.split(/\s+/)[0]

    // Check against dangerous commands list
    if (DANGEROUS_BASH_COMMANDS.some(cmd => baseCommand === cmd || commandStr.includes(cmd))) {
      return "ask"
    }
  }

  if (toolName === "write" || toolName === "edit") {
    // Ask for writes outside cwd
    const filePath = String(args.file_path || "")
    if (filePath.startsWith("..") || filePath.startsWith("/")) {
      return "ask"
    }
  }

  return "allow"
}
```

2. Integrate with agent hooks in `src/server/agent.ts`:
```typescript
// In executeTool method, enhance the beforeToolExecute logic

// The existing hooks.beforeToolExecute returns "allow" | "deny" | "ask"
// For "ask", we need to implement user confirmation flow:
// - Return a special event to the client asking for permission
// - Client responds with allow/deny
// - Agent proceeds or cancels tool execution

// NOTE: Full "ask" flow requires client-server protocol extension
// This is a larger change - for now, treat "ask" as "deny" with a message
```

**Testing:**
- Test dangerous bash commands trigger "ask" (or "deny" as interim)
- Test safe commands return "allow"
- Test write outside cwd triggers "ask"
- Test pattern matching for "rm -rf" vs "rm -r"

**Verification:**
```bash
npm run build
npm test
```

---

### Task 5: Extract TUI State Management (P3 - Lower Priority)

**Problem:** `src/tui/App.tsx` has too many responsibilities: messages, streaming, thinking, tool states, commands, theme, resize all in one component.

**Files:**
- Create: `src/tui/state/sessionReducer.ts`
- Create: `src/tui/state/types.ts`
- Modify: `src/tui/App.tsx` (use reducer)
- Create: `src/tui/state/__tests__/sessionReducer.test.ts`

**Implementation:**

1. Create `src/tui/state/types.ts`:
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

2. Create `src/tui/state/sessionReducer.ts`:
```typescript
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "ADD_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] }
    case "APPEND_CONTENT":
      return { ...state, streaming: { ...state.streaming, content: state.streaming.content + action.delta } }
    // ... handle all actions
    default:
      return state
  }
}
```

3. Refactor `App.tsx` to use `useReducer`:
```typescript
import { useReducer } from "react"
import { sessionReducer, initialState } from "./state/sessionReducer"

// Replace multiple useState calls with:
const [state, dispatch] = useReducer(sessionReducer, initialState)

// Replace setMessages/setStreaming/etc with dispatch calls
```

**Testing:**
- Test reducer handles all action types
- Test state transitions are correct

**Verification:**
```bash
npm run build
npm test
```

---

## Execution Order

1. **Task 1** (Tool Result Injection) - MUST BE FIRST - fixes core functionality
2. **Task 2** (stdout Pollution) - Quick fix, prevents protocol corruption
3. **Task 3** (Provider Type) - Quick type fix, enables google provider
4. **Task 4** (Security) - Important for production use
5. **Task 5** (TUI State) - Can be deferred, improves maintainability

## Commit Strategy

After each task:
```bash
git add -A
git commit -m "fix(agent): [Task N] description"
```

## Verification Commands

```bash
# After all tasks
npm run build
npm test
```

## Dependencies Between Tasks

```
Task 1 ─────────────────────────────────────────────┐
Task 2 ─────────────────────────────────────────────┼──> Final verification
Task 3 ─────────────────────────────────────────────┤
Task 4 (can run in parallel with 1-3) ───────────────┤
Task 5 (can be deferred) ────────────────────────────┘
```

Tasks 1, 2, 3 can run in parallel (no dependencies).
Task 4 depends on Task 1's hook structure being stable.
Task 5 is independent and can be done last or deferred.

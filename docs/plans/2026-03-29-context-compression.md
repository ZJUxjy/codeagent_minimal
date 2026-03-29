# Context Compression — Development Plan

**Date:** 2026-03-29
**Scope:** Replace silent message truncation with LLM-driven summarization, so long sessions preserve intent and decisions rather than silently losing early context.

---

## Current State

`src/server/utils/truncateMessages.ts` already handles overflow:

```
estimateTokens() → 3.5 chars/token
truncateMessages() → drop oldest turns until under DEFAULT_MAX_TOKENS (100K)
```

Called every turn at `agent.ts:200`:
```typescript
convertToolMessages(truncateMessages(store.getAll()))
```

**The problem:** Silent truncation loses context permanently — the model forgets goals, decisions, and file changes from early in the session. No summary, no notification, just gone.

---

## Scope vs. qwen-code

| Feature | qwen-code | Our v1 |
|---|---|---|
| Trigger | 70% of model context window (real token count) | 75% of configurable limit (char estimate) |
| Algorithm | LLM summarizes old turns into XML `<state_snapshot>` | LLM summarizes old turns into Markdown summary |
| Preserve | Last 30% uncompressed | Last 30% uncompressed |
| Token counting | Model-reported (`usageMetadata`) | Char estimation (3.5 chars/token, same as now) |
| Summary injection | Synthetic user+model message pair | Same pattern |
| User notification | Info message in UI | `AgentEvent` → TUI info message |
| Manual trigger | Infrastructure only (no UI) | `/compress` slash command (v1) |
| Failure recovery | `hasFailedCompressionAttempt` flag, skip future auto-compress | Same flag, same behaviour |
| Format | XML `<state_snapshot>` | Markdown (simpler, less token overhead) |
| Config | `chatCompression.contextPercentageThreshold` | `compression.threshold` in config |

---

## Architecture

```
runLoop(), top of each turn
      │
      ▼
shouldCompress(store, opts)?     ← char-estimate > 75% of limit
      │ yes
      ▼
compressContext(store, llm, signal)
      │
   1. findSplitPoint(messages)       → split at 70% by char count, on user-msg boundary
   2. llm.complete(summaryPrompt, toCompress)  → Markdown summary
   3. replacedMessages = [summaryUserMsg, summaryAckMsg, ...tail]
   4. store.replaceAll(replacedMessages)
   5. yield AgentEvent { type: "context_compressed", ... }
      │
      ▼
llm.stream(store.getAll(), ...)    ← now within token budget
```

`truncateMessages()` stays as a **last-resort safety net** — if compression fails or is disabled, the old truncation still fires. Belt and suspenders.

---

## Phase 1: Compression Engine

### 1.1 `shouldCompress(messages, opts)` — trigger check

```typescript
// src/server/compression/compressor.ts
const COMPRESSION_THRESHOLD = 0.75   // compress when estimated tokens > 75% of limit
const PRESERVE_TAIL_RATIO   = 0.30   // keep last 30% of messages uncompressed

export function shouldCompress(
  messages: CoreMessage[],
  opts: CompressionOptions,
): boolean {
  if (opts.disabled) return false
  if (opts.failedLastAttempt) return false   // don't retry after failure
  const estimated = messages.reduce((s, m) => s + estimateTokens(m), 0)
  const limit = opts.tokenLimit ?? DEFAULT_MAX_TOKENS
  return estimated / limit >= COMPRESSION_THRESHOLD
}
```

### 1.2 `findSplitPoint(messages)` — where to cut

Walk from oldest to newest, accumulate char count. Split once we've accumulated 70% of total chars, **only at a `user` message boundary**, and **never immediately after an assistant message that has tool calls** (tool call + tool result must stay together).

Mirrors qwen-code's `findCompressSplitPoint()` logic exactly — this invariant is required by API message ordering rules.

```typescript
function findSplitPoint(messages: CoreMessage[]): number {
  const total = messages.reduce((s, m) => s + charLen(m), 0)
  const target = total * (1 - PRESERVE_TAIL_RATIO)   // 70% of chars
  let accumulated = 0
  let splitIdx = 0

  for (let i = 0; i < messages.length; i++) {
    accumulated += charLen(messages[i])
    // Only split at user message boundaries
    if (messages[i].role === "user" && accumulated >= target) {
      // Don't split if the previous message has unresolved tool calls
      const prev = messages[i - 1]
      if (prev && hasToolCalls(prev)) continue
      splitIdx = i
      break
    }
  }
  return splitIdx
}
```

### 1.3 Compression prompt

Markdown output — simpler than XML, fewer tokens, easier for models to generate:

```
You are a context compression assistant. The conversation history below will be
discarded to free up context. Your task: write a dense Markdown summary that
preserves everything a developer needs to continue the session.

Include:
## Goal
One sentence: what is the user trying to accomplish?

## Key Decisions
Decisions made, approaches chosen, things ruled out.

## Files Changed
List of files created/modified/deleted and what changed.

## Current State
What is done, what is in progress, what still needs doing.

## Important Context
Facts, constraints, error messages, or environment details the agent must remember.

Be dense. Omit conversation filler. Preserve specifics (file paths, function names,
error text, command output). The developer will not see the original messages again.
```

### 1.4 `compressContext(store, llm, signal)` — main function

```typescript
export async function compressContext(
  store: MessageStore,
  llm: LLMClient,
  signal?: AbortSignal,
): Promise<CompressionResult> {
  const messages = store.getAll()
  const splitIdx = findSplitPoint(messages)
  if (splitIdx === 0) return { status: "noop" }    // nothing to compress

  const toCompress = messages.slice(0, splitIdx)
  const tail       = messages.slice(splitIdx)

  const summary = await llm.complete(COMPRESSION_SYSTEM_PROMPT, toCompress, signal)
  if (!summary?.trim()) return { status: "failed_empty" }

  // Inject summary as synthetic user + assistant message pair
  // (same pattern as qwen-code — model sees it as prior user-provided context)
  const compressed: CoreMessage[] = [
    { role: "user",      content: `[Context Summary — previous messages compressed]\n\n${summary}` },
    { role: "assistant", content: "Understood. I have the context summary and will continue from there." },
    ...tail,
  ]

  const before = estimateTokensBulk(messages)
  const after  = estimateTokensBulk(compressed)

  if (after >= before) return { status: "failed_inflated" }

  store.replaceAll(compressed)
  return { status: "compressed", tokensBefore: before, tokensAfter: after }
}
```

**`MessageStore` needs one new method:** `replaceAll(messages: CoreMessage[])`.

### 1.5 `CompressionResult` and `CompressionOptions` types

```typescript
export type CompressionStatus =
  | "compressed"
  | "noop"
  | "failed_empty"
  | "failed_inflated"
  | "disabled"

export interface CompressionResult {
  status: CompressionStatus
  tokensBefore?: number
  tokensAfter?:  number
}

export interface CompressionOptions {
  disabled?: boolean
  failedLastAttempt?: boolean
  tokenLimit?: number
}
```

**Files:** `src/server/compression/compressor.ts`, `src/server/compression/index.ts`

---

## Phase 2: Agent Integration

### 2.1 Add `AgentEvent` for compression notification

```typescript
// src/server/agent.ts
export type AgentEvent =
  | ...existing events...
  | { type: "context_compressed"; tokensBefore: number; tokensAfter: number }
```

### 2.2 Wire compression into `runLoop`

At the top of each turn, before calling `llm.stream()`:

```typescript
// Top of each turn in runLoop
if (shouldCompress(store.getAll(), compressionOpts)) {
  const result = await compressContext(store, this.llm, signal)
  if (result.status === "compressed") {
    yield { type: "context_compressed", tokensBefore: result.tokensBefore!, tokensAfter: result.tokensAfter! }
  } else if (result.status === "failed_empty" || result.status === "failed_inflated") {
    compressionOpts.failedLastAttempt = true   // skip auto-compress for rest of session
  }
}

// Existing LLM call (truncateMessages still runs as fallback)
const stream = this.llm.stream(
  convertToolMessages(truncateMessages(store.getAll())),
  ...
)
```

`compressionOpts` lives as a local variable in `runLoop` — it's session-scoped state, not persisted.

### 2.3 `LLMClient` needs a `complete()` method

The compression needs a non-streaming LLM call (we just want the summary string, not a stream):

```typescript
// src/llm.ts
async complete(systemPrompt: string, messages: CoreMessage[], signal?: AbortSignal): Promise<string>
```

This calls the same provider with `stream: false` (or accumulates the stream into a string).

**Files:** `src/server/agent.ts`, `src/llm.ts`, `src/server/store.ts` (add `replaceAll`)

---

## Phase 3: TUI Notification

When `context_compressed` event arrives at the client, show an inline info message:

```
ℹ Context compressed: 87K → 31K estimated tokens (session was approaching limit).
```

### 3.1 Protocol: add event to notifications

```typescript
// src/protocol/types.ts
export interface ContextCompressedNotification extends JsonRpcNotification {
  method: "context_compressed"
  params: { tokensBefore: number; tokensAfter: number }
}
```

### 3.2 Client handles the event

```typescript
// src/client/index.ts — ClientEvent union
| { type: "context_compressed"; tokensBefore: number; tokensAfter: number }
```

### 3.3 App.tsx shows a system message

```typescript
case 'context_compressed':
  uiOps.addSystemMessage(
    `Context compressed: ~${Math.round(event.tokensBefore / 1000)}K → ~${Math.round(event.tokensAfter / 1000)}K estimated tokens.`
  )
  break
```

**Files:** `src/protocol/types.ts`, `src/client/index.ts`, `src/server/index.ts`, `src/tui/App.tsx`

---

## Phase 4: `/compress` Slash Command

Manual trigger for power users who want to compress before hitting the limit:

```
/compress     — compress context now, show token delta
```

```typescript
// src/commands/builtin/compressCommand.ts
// Sends a "compress" RPC to server
// Server calls compressContext(store, llm) with force=true (skip threshold check)
// Returns { status, tokensBefore, tokensAfter }
// Command displays result or error
```

**Files:** `src/commands/builtin/compressCommand.ts`, `src/commands/builtin/index.ts`, `src/server/index.ts`

---

## Implementation Order

| Phase | Effort | Value | Priority |
|---|---|---|---|
| 1 — Compression engine | M (4–5h) | Core | **P0** |
| 2 — Agent integration | S (2h) | Core | **P0** |
| 3 — TUI notification | S (1h) | High | **P0** |
| 4 — `/compress` command | S (1h) | Medium | **P1** |

Phases 1–3 are the MVP. Auto-compression happens transparently; user is notified via info message.

---

## Key Differences from Current `truncateMessages()`

| Aspect | `truncateMessages()` (current) | Compression (new) |
|---|---|---|
| What's lost | Entire old turns | Old turns replaced by dense summary |
| User notification | Silent | Info message with token delta |
| Model awareness | Doesn't know context was cut | Sees a summary, understands prior work |
| Trigger | Every call (if over limit) | Once per session when threshold crossed |
| After trigger | Messages gone forever | Summary in context, session continues |

`truncateMessages()` remains as a **hard safety net** — if compression is disabled or failed, it prevents API errors from oversized contexts.

---

## Reuse from Existing Code

| New need | Reuse from |
|---|---|
| `estimateTokens()` | `src/server/utils/truncateMessages.ts` — export and import |
| `groupIntoTurns()` | Same file — needed for split-point logic |
| `MessageStore.getAll()` | Already exists in `src/server/store.ts` |
| `LLMClient` streaming | `src/llm.ts` — add `complete()` alongside `stream()` |
| `addSystemMessage` UI pattern | Already in `App.tsx` for other info messages |
| Slash command pattern | Any existing command in `src/commands/builtin/` |

`estimateTokens` and `groupIntoTurns` should be **exported** from `truncateMessages.ts` for reuse rather than duplicated.

---

## File Structure After Implementation

```
src/server/compression/
  compressor.ts      ← shouldCompress(), findSplitPoint(), compressContext()
  prompt.ts          ← COMPRESSION_SYSTEM_PROMPT constant
  index.ts           ← re-export

src/server/utils/
  truncateMessages.ts  ← export estimateTokens, groupIntoTurns (no logic change)

src/commands/builtin/
  compressCommand.ts   ← /compress slash command
```

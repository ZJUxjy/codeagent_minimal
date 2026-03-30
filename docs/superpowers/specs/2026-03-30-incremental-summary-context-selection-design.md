# Incremental Summary + Context Selection Design

**Date:** 2026-03-30
**Status:** Draft
**Type:** Experimental feature (opt-in via config)

## Problem

Current context management uses two mechanisms:
1. `truncateMessages` — drops oldest turns when tokens exceed limit (lossy)
2. `compressContext` — summarizes all old messages at 75% threshold, replaces them with a single summary (also lossy, blocks the agent loop)

Both approaches discard information. Long sessions lose details about early decisions, file changes, and error messages.

## Goal

Implement "theoretically lossless" context compression:
- After each agent turn, asynchronously generate a structured 5-section summary
- Before each new user message, use an LLM to select which historical turns need their full original messages
- Always include all summaries as context prefix — nothing is ever fully discarded

## Data Model

### Stable Message IDs

Every message added to `MessageStore` receives a monotonically increasing numeric ID (`messageId`). `TurnMeta` and `TurnSummary` reference these IDs instead of array indices. This is resilient to `MessageStore.replaceAll()` calls (from `compressContext` fallback).

When `compressContext` fires as fallback, all summary data is cleared via `TurnSummaryStore.clear()` — the compressed messages have different IDs and old summaries are invalidated.

### TurnSummary

```typescript
interface TurnSummary {
    turnId: string          // UUID
    startMsgId: number      // Start message ID in MessageStore
    endMsgId: number        // End message ID in MessageStore
    summary: string         // 5-section Markdown (Goal, Key Decisions, Files Changed, Current State, Important Context)
    createdAt: number       // Timestamp
    tokenCount: number      // Estimated token count of summary
}
```

### TurnMeta

```typescript
interface TurnMeta {
    turnId: string
    startMsgId: number      // Stable message ID
    endMsgId: number        // Stable message ID
    hasSummary: boolean     // false = pending or failed, must preserve full messages
    isPending: boolean      // true = currently being summarized
    isFailed: boolean       // true = summarization failed permanently
}
```

### SelectionResult

```typescript
interface SelectionResult {
    fullTurns: string[]     // Turn IDs to include with full original messages
    allSummaries: string    // All summaries merged into a single string (always included)
}
```

## Architecture

### TurnSummaryStore

Parallel to `MessageStore`, stores per-turn summaries. In-memory implementation (`InMemoryTurnSummaryStore`), no persistence for v1.

```typescript
interface TurnSummaryStore {
    add(summary: TurnSummary): void
    get(turnId: string): TurnSummary | undefined
    getAll(): TurnSummary[]
    setPending(turnId: string): void
    isPending(turnId: string): boolean
    setFailed(turnId: string, reason: string): void
    isFailed(turnId: string): boolean
    clear(): void
}
```

### TurnTracker

Lightweight utility that tracks turn boundaries as messages are added to `MessageStore`.

**Note:** This uses a **user-centric** grouping — a turn starts at each `user` message and ends before the next `user` message (inclusive of all `assistant` and `tool` messages in between). This differs from `groupIntoTurns()` in `truncateMessages.ts` which uses an **assistant-centric** grouping. The user-centric definition is more natural for summarization because it captures "what happened in response to a user request."

Each message gets a stable `messageId` assigned by the tracker (monotonically increasing counter).

### Summarizer

Async fire-and-forget component. Uses a dedicated `LLMClient` (configurable provider/model) via `LLMClient.complete()` (non-streaming).

```typescript
class Summarizer {
    constructor(client: LLMClient, summaryStore: TurnSummaryStore)
    async summarize(turnId: string, messages: CoreMessage[]): Promise<void>
    abort(): void
}
```

**Trigger conditions** — summarization fires only on clean completions:
- `finishReason === "stop"` (no more tool calls, natural end)
- `finishReason === "length"` (max turns reached, agent produced final answer)

**Does NOT fire on:**
- `finishReason === "interrupted"` (user interrupted)
- `finishReason.startsWith("error")` (LLM error)

**Message snapshot:** `turnMessages` passed to `summarize()` is a snapshot captured at call time (`store.getAll().slice(startIdx, endIdx + 1)`). The summarizer does not read from the store directly, avoiding race conditions if a new `run()` starts before async summarization completes.

**Error handling:** Errors are caught, logged, and `summaryStore.setFailed(turnId, reason)` is called. Failed turns are treated identically to pending turns — their full messages are preserved in context.

**Lifecycle:** `abort()` cancels the in-progress `AbortController` when `signal.aborted` fires. The promise is `.catch()`-ed to prevent unhandled rejections.

### ContextSelector

Async component called before each LLM stream. Uses the same dedicated `LLMClient` via `LLMClient.complete()` (non-streaming). Expected latency: 1-3 seconds with a fast model (e.g., glm-4-flash).

```typescript
class ContextSelector {
    constructor(client: LLMClient)
    async select(
        userMessage: string,
        summaries: TurnSummary[],
        turns: TurnMeta[],
    ): Promise<SelectionResult>
}
```

**Skip condition:** Selection is skipped entirely when:
- Total estimated context tokens (all messages) are well under the limit (e.g., < 30% of `DEFAULT_MAX_TOKENS`) AND the number of turns is small (e.g., ≤ 3). In this case, all messages are passed through directly without any selection overhead.

**Selection prompt includes:**
- All completed summaries (as reference material)
- Brief description of each turn (turnId + first 100 chars of user message)
- The new user question

**Hardcoded rules (not delegated to LLM):**
- Turns without summary (`!hasSummary`) → always include full messages (pending/failed fallback)
- Most recent 1 user-initiated turn → always include full messages (current context)
- All summaries → always included in context prefix

**Note on "most recent 1 turn":** This means the most recent user-initiated turn, which may span multiple agent-loop iterations (tool call → result → more tool calls → final answer). If this turn's messages are very large (e.g., many file reads), `truncateMessages` is still applied as a safety net after context assembly.

### Context Assembly

The assembled `CoreMessage[]` passed to `llm.stream()`:

```typescript
const assembled: CoreMessage[] = []

// 1. Summaries as a single user message (same pattern as existing compressContext)
assembled.push({ role: "user", content: `[Context Summaries — per-turn summaries from earlier in the session]\n\n${allSummaries}` })

// 2. Assistant ack (prevents user→user adjacency, same pattern as compressContext)
assembled.push({ role: "assistant", content: "Understood. I have the context summaries and will continue from there." })

// 3. Full original messages for selected turns (in chronological order)
for (const turn of selectedTurns) {
    assembled.push(...turn.messages)  // raw CoreMessage[] from store
}

// 4. Current user question (already in store, included via selected turns for the current turn)
```

**Post-assembly processing:** After assembly, `convertToolMessages()` is applied (same as existing path). `truncateMessages()` is also applied as a final safety net — if the assembled context (summaries + selected turns) still exceeds `DEFAULT_MAX_TOKENS`, oldest selected turns are dropped.

## Configuration

New field in `LopConfig`:

```typescript
interface SummaryConfig {
    enabled: boolean          // Opt-in toggle, default false
    model?: string            // Independent model (e.g., "glm-4-flash"), defaults to main agent's model
    provider?: Provider       // Independent provider, defaults to main agent's provider
    apiKey?: string           // Independent API key
    baseURL?: string          // Independent base URL
}
```

**Config resolution:** `SummaryConfig` is read only from the config file. No separate CLI flags or env vars for v1 — keep it simple for an experimental feature.

Config file example:
```json
{
    "summary": {
        "enabled": true,
        "provider": "glm",
        "model": "glm-4-flash"
    }
}
```

## Agent Loop Integration

Changes in `agent.ts` `runLoop()`:

```
Before:
  shouldCompress? → compressContext
  llm.stream(convertToolMessages(truncateMessages(store.getAll())))

After (when summary.enabled):
  contextSelector.select(userMessage, summaries, turns) → selectedMessages
  llm.stream(convertToolMessages(truncateMessages(selectedMessages)))
  → on clean done (stop/length): capture turn snapshot, fire-and-forget summarizer.summarize()

Fallback (when summary.enabled === false):
  Original path unchanged

Selection failure modes (all fall through to original truncateMessages path):
  - LLM call timeout or network error
  - LLM returns malformed output (not parseable JSON)
  - Assembled context exceeds token budget even after selection
```

**Interrupt handling:** When `signal.aborted`, call `summarizer.abort()` to cancel in-progress summarization.

**compressContext interaction:** When `compressContext` fires (e.g., if context selection is skipped and context still exceeds 75% threshold), it calls `store.replaceAll()` which invalidates all summary indices. The integration code must call `summaryStore.clear()` after any `compressContext` invocation.

## What Does NOT Change

- `MessageStore` interface — unchanged
- `LLMClient` — unchanged (just a second instance)
- JSON-RPC protocol — no new methods or notifications for v1
- TUI — selection is transparent to the user
- Existing `compressContext` — remains as fallback
- `truncateMessages` — remains as post-assembly safety net

## File Structure

```
src/server/
  summary/
    types.ts              # TurnSummary, TurnMeta, SelectionResult, SummaryConfig
    turnSummaryStore.ts   # InMemoryTurnSummaryStore
    turnTracker.ts        # Turn boundary tracking + stable message IDs
    summarizer.ts         # Async summarization (fire-and-forget)
    contextSelector.ts    # Context selection (async, before LLM call)
    prompts.ts            # Summarization prompt + selection prompt
    index.ts              # Re-exports
```

## Trade-offs

| Aspect | Benefit | Cost |
|--------|---------|------|
| Async summarization | No latency added to agent responses | Extra LLM calls (cheap model) |
| All summaries always included | Zero information loss | Fixed context overhead (~summaries) |
| LLM-based selection | Semantic relevance, not heuristic | One extra LLM call per user turn (1-3s latency) |
| Skip condition for small contexts | No overhead when unnecessary | Slight complexity in skip logic |
| Separate provider config | Cost optimization with cheap models | Config complexity |
| In-memory store only (v1) | Simple implementation | Summaries lost on restart |
| Stable message IDs | Resilient to store mutations | Requires messageId tracking |

**Future consideration (v2):** For very long sessions, accumulated summaries themselves may become substantial. A "summary-of-summaries" mechanism could be added later.

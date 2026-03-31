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

Implement a **loss-minimizing context recall** system:
- After each completed user-initiated turn, asynchronously generate a structured 5-section summary
- Before processing each **new user message**, use an LLM once to select which historical turns need their full original messages
- Keep the canonical full history in `MessageStore`; summaries are auxiliary retrieval metadata, not a replacement for source messages
- Degrade gracefully when safety limits are hit, while making loss explicit and observable

## Non-Goals

- This feature does **not** guarantee literal losslessness under all conditions
- This feature does **not** remove the need for final token-budget safety checks
- This feature does **not** persist summaries across process restarts in v1

**Important boundary:** if `truncateMessages()` or per-tool result capping fires, information can still be lost for that request. The design goal is to reduce loss substantially during normal long-running sessions, not to mathematically eliminate it

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

**Ownership:** `TurnSummaryStore` owns summary content and pending/failed state. `TurnTracker` owns turn boundaries and message IDs. When building `TurnMeta[]` for `ContextSelector`, the code merges `TurnTracker`'s boundary info with `TurnSummaryStore`'s summary/pending/failed state.

```typescript
interface TurnSummaryStore {
    add(summary: TurnSummary): void
    get(turnId: string): TurnSummary | undefined
    getAll(): TurnSummary[]
    getFailedReason(turnId: string): string | undefined
    setPending(turnId: string): void
    isPending(turnId: string): boolean
    setFailed(turnId: string, reason: string): void
    isFailed(turnId: string): boolean
    clear(): void
}
```

Note: `TurnMeta.hasSummary`, `TurnMeta.isPending`, `TurnMeta.isFailed` are derived from `TurnSummaryStore` at query time — they are not stored separately in `TurnTracker`.

### TurnTracker

Lightweight utility that tracks turn boundaries as messages are added to `MessageStore`.

**Note:** This uses a **user-centric** grouping — a turn starts at each `user` message and ends before the next `user` message (inclusive of all `assistant` and `tool` messages in between). This differs from `groupIntoTurns()` in `truncateMessages.ts` which uses an **assistant-centric** grouping. The user-centric definition is more natural for summarization because it captures "what happened in response to a user request."

Each message gets a stable `messageId` assigned by the tracker (monotonically increasing counter). `TurnTracker` maintains its own `nextId` counter — `MessageStore` is not modified. The mapping from `messageId` to array index is managed internally by `TurnTracker`. When `compressContext` fires and `TurnSummaryStore.clear()` is called, `TurnTracker` also resets its mapping.

### Summarizer

Async fire-and-forget component. Uses a dedicated `LLMClient` (configurable provider/model) via `LLMClient.complete()` (non-streaming).

```typescript
class Summarizer {
    constructor(client: LLMClient, summaryStore: TurnSummaryStore)
    async summarize(turnId: string, messages: CoreMessage[]): Promise<void>
    abort(): void
}
```

**Execution model:** v1 uses a per-session FIFO queue with concurrency = 1. At most one summarization request is in flight at a time. Additional completed turns are queued. If a turn is already pending or already summarized, duplicate enqueue is ignored.

**Trigger conditions** — summarization is enqueued only when a user-initiated turn reaches a clean terminal state:
- `finishReason === "stop"` and there are no pending tool calls
- The run was not interrupted
- The run did not end in an error state

**Does NOT fire on:**
- `finishReason === "interrupted"` (user interrupted)
- `finishReason === "length"` (outer loop max-turn stop is not treated as semantically complete in v1)
- `finishReason.startsWith("error")` (LLM error)

**Message snapshot:** `turnMessages` passed to `summarize()` is a snapshot captured at call time (`store.getAll().slice(startIdx, endIdx + 1)`). The summarizer does not read from the store directly, avoiding race conditions if a new `run()` starts before async summarization completes.

**Error handling:** Errors are caught, logged, and `summaryStore.setFailed(turnId, reason)` is called. Failed turns are treated identically to pending turns — their full messages are preserved in context. No automatic retry in v1; failure is observable through logs and store inspection.

**Lifecycle:** `abort()` cancels the in-progress `AbortController` when `signal.aborted` fires. The promise is `.catch()`-ed to prevent unhandled rejections.

### ContextSelector

Async component called **once per new user message**, before the **first** `llm.stream()` of that run. It is **not** called again for internal agent-loop iterations triggered by tool calls. Uses the same dedicated `LLMClient` via `LLMClient.complete()` (non-streaming). The selection prompt is structured as: `systemPrompt` = selection instructions, `messages` = a single user message containing summaries + turn descriptions + the new user question. Expected latency: 1-3 seconds with a fast model (e.g., glm-4-flash).

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

**Post-assembly processing:** After assembly, `convertToolMessages()` is applied (same as existing path — see Agent Loop Integration section below for the actual call site). `truncateMessages()` remains the final safety net — if the assembled context (summaries + selected turns) still exceeds `DEFAULT_MAX_TOKENS`, oldest selected turns may still be dropped for that request. This is an explicit degraded-mode path, not part of the "normal" design target.

### Working Context vs Canonical History

To avoid re-running selection on every tool-loop iteration, the runtime maintains two separate views:

- **Canonical history (`MessageStore`)**: full session transcript, append-only during the run
- **Working context (`CoreMessage[]`)**: the selected/summarized message list actually sent to `llm.stream()`

Flow:
1. On `Agent.run(userMessage)`, append the user message to `MessageStore`
2. Run `ContextSelector` once and build the initial `workingContext`
3. Call `llm.stream(convertToolMessages(truncateMessages(workingContext)))`
4. As assistant/tool messages are produced, append them to both `MessageStore` and `workingContext`
5. Subsequent internal iterations (after tool results) continue from `workingContext`, not from `store.getAll()`

This keeps the selector cost at one LLM call per user message while preserving the full transcript for later summarization and debugging.

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
  Agent.run(userMessage):
    store.add(userMessage)
    contextSelector.select(userMessage, summaries, turns) → workingContext

  each loop iteration:
    llm.stream(convertToolMessages(truncateMessages(workingContext)))
    append assistant/tool messages to both store and workingContext

  on clean done (stop, no pending tools):
    capture canonical turn snapshot from store
    enqueue summarizer.summarize()

Fallback (when summary.enabled === false):
  Original path unchanged

Selection failure modes (all fall through to original `store.getAll()` + `truncateMessages` path for that run):
  - LLM call timeout or network error
  - LLM returns malformed output (not parseable JSON)
  - Selector returns unknown / invalid turn IDs

Degraded execution (selection succeeded, but context is still too large):
  - Apply deterministic pruning first (drop oldest selected summarized turns)
  - If still too large, apply `truncateMessages()` as the final safety net
  - Emit debug logging so loss is observable
```

**Interrupt handling:** When `signal.aborted`, call `summarizer.abort()` to cancel in-progress summarization.

**compressContext interaction:** When `summary.enabled`, the normal 75% proactive `shouldCompress() → compressContext()` path is disabled. Otherwise the canonical full transcript would be mutated before the selector can use it, defeating the purpose of this feature.

`compressContext` remains available only as:
- the existing path when `summary.enabled === false`
- a manual or emergency fallback if the selected working context cannot be made to fit safely

If `compressContext` is invoked while summary mode is active, it calls `store.replaceAll()` and invalidates all tracked message IDs. The integration code must immediately call:
- `summaryStore.clear()`
- `turnTracker.reset()`

and then continue from the compressed canonical store as a fresh baseline.

## Testing Strategy

Minimum v1 coverage should include:

1. `TurnTracker` assigns stable monotonically increasing IDs and resets correctly after fallback compression
2. `ContextSelector` is called once per new user message, not once per tool-loop iteration
3. Pending turns are always preserved as full messages
4. Failed summaries are always preserved as full messages and expose a failure reason
5. Clean completion (`stop`) enqueues summarization; `interrupted`, `error*`, and `length` do not
6. Working context continues correctly across assistant/tool iterations without re-reading full `store.getAll()`
7. Selection malformed output falls back to the original path for that run
8. Deterministic pruning + `truncateMessages()` still produce a valid provider-safe sequence
9. Emergency/manual `compressContext` clears summary state and resets turn tracking
10. Very large tool outputs still behave correctly when capped/truncated
11. Summary mode disabled preserves existing behavior exactly
12. Summary mode enabled but no summaries available yet still produces valid history

## What Does NOT Change

- `MessageStore` interface — unchanged
- `LLMClient` — unchanged (just a second instance)
- JSON-RPC protocol — no new methods or notifications for v1
- TUI — selection is transparent to the user
- Existing `compressContext` implementation — unchanged, but no longer part of the normal hot path when summary mode is enabled
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
| All summaries always included | Better long-range recall across long sessions | Fixed context overhead (~summaries) |
| LLM-based selection | Semantic relevance, not heuristic | One extra LLM call per user turn (1-3s latency) |
| Skip condition for small contexts | No overhead when unnecessary | Slight complexity in skip logic |
| Separate provider config | Cost optimization with cheap models | Config complexity |
| In-memory store only (v1) | Simple implementation | Summaries lost on restart |
| Stable message IDs | Resilient to store mutations | Requires messageId tracking |

**Future consideration (v2):** For very long sessions, accumulated summaries themselves may become substantial. A "summary-of-summaries" mechanism could be added later.

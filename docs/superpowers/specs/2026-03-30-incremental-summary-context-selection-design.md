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

### TurnSummary

```typescript
interface TurnSummary {
    turnId: string          // UUID
    startIdx: number        // Start index in MessageStore
    endIdx: number          // End index in MessageStore
    summary: string         // 5-section Markdown (Goal, Key Decisions, Files Changed, Current State, Important Context)
    createdAt: number       // Timestamp
    tokenCount: number      // Estimated token count of summary
}
```

### TurnMeta

```typescript
interface TurnMeta {
    turnId: string
    startIdx: number
    endIdx: number
    hasSummary: boolean     // false = pending or failed, must preserve full messages
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
    clear(): void
}
```

### TurnTracker

Lightweight utility that tracks turn boundaries as messages are added to `MessageStore`. A turn starts at each `user` message and ends before the next `user` message.

### Summarizer

Async fire-and-forget component. Uses a dedicated `LLMClient` (configurable provider/model).

```typescript
class Summarizer {
    constructor(client: LLMClient, summaryStore: TurnSummaryStore)
    async summarize(turnId: string, messages: CoreMessage[]): Promise<void>
    abort(): void
}
```

- Triggered when agent finishes a turn (`finishReason === "stop"`, no pending tool calls)
- Fire-and-forget: does not block `done` event yield
- Errors silently caught and logged (turn remains pending)
- `abort()` cancels in-progress LLM call via `AbortController`

### ContextSelector

Synchronous component called before each LLM stream. Uses the same dedicated `LLMClient`.

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

**Selection prompt includes:**
- All completed summaries (as reference material)
- Brief description of each turn (turnId + first 100 chars of user message)
- The new user question

**Hardcoded rules (not delegated to LLM):**
- Turns without summary → always include full messages (pending/failed fallback)
- Most recent 1 turn → always include full messages (current context)
- All summaries → always included in context prefix

**Final context assembly:**
```
[All summaries merged as a user message]  ← always present
[Full original messages for selected turns] ← LLM decides
[Current user question]                     ← latest
```

## Configuration

New field in `LopConfig`:

```typescript
interface SummaryConfig {
    enabled: boolean          // Opt-in toggle, default false
    provider?: Provider       // Independent provider, defaults to main agent's provider
    model?: string            // Independent model, defaults to main agent's model
    apiKey?: string           // Independent API key
    baseURL?: string          // Independent base URL
}
```

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
  llm.stream(truncateMessages(store.getAll()))

After (when summary.enabled):
  contextSelector.select(userMessage, summaries, turns) → selectedMessages
  llm.stream(selectedMessages)
  → on done: summarizer.summarize(turnId, turnMessages)  // fire-and-forget

Fallback (when summary.enabled === false or selection fails):
  Original truncateMessages path, unchanged
```

**Interrupt handling:** When `signal.aborted`, call `summarizer.abort()` to cancel in-progress summarization.

## What Does NOT Change

- `MessageStore` interface — unchanged
- `LLMClient` — unchanged (just a second instance)
- JSON-RPC protocol — no new methods; optional new notification `context_selected`
- TUI — selection is transparent to the user
- Existing `compressContext` — remains as fallback
- `truncateMessages` — remains as fallback

## File Structure

```
src/server/
  summary/
    types.ts              # TurnSummary, TurnMeta, SelectionResult, SummaryConfig
    turnSummaryStore.ts   # InMemoryTurnSummaryStore
    turnTracker.ts        # Turn boundary tracking
    summarizer.ts         # Async summarization (fire-and-forget)
    contextSelector.ts    # Context selection (synchronous before LLM call)
    prompts.ts            # Summarization prompt + selection prompt
    index.ts              # Re-exports
```

## Trade-offs

| Aspect | Benefit | Cost |
|--------|---------|------|
| Async summarization | No latency added to agent responses | Extra LLM calls (cheap model) |
| All summaries always included | Zero information loss | Fixed context overhead (~summaries) |
| LLM-based selection | Semantic relevance, not heuristic | One extra LLM call per user turn |
| Separate provider config | Cost optimization with cheap models | Config complexity |
| In-memory store only (v1) | Simple implementation | Summaries lost on restart |

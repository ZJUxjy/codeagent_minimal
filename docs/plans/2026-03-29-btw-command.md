# `/btw` Command — Development Plan

**Date:** 2026-03-29
**Scope:** Add an ephemeral "by the way" side-question command. Users can ask quick questions using the current conversation as context without polluting the main chat history.

---

## What We're Building

A `/btw` slash command that lets users ask ephemeral side-questions. The question is answered by the LLM using the current conversation history as context, but the Q&A is never added to the conversation state. It's non-blocking (runs in parallel), cancellable, and tool-free.

**Example usage:**

```
user>   Refactor the auth module to use JWT tokens
agent>  [working on refactoring, making tool calls...]
user>   /btw what's the difference between HS256 and RS256?
agent>  [btw overlay appears] HS256 uses a shared secret, RS256 uses public/private key pair...
        Press Space/Enter/Escape to dismiss
user>   [presses Escape, overlay disappears, main conversation continues]
```

---

## Architecture

```
User types "/btw what does X mean?"
        │
        ▼
  TUI: btwCommand.action()
        │  Sets btwItem state, calls client.btw(question)
        │
        ▼
  Client: sendRequest("btw", { message })
        │
        ▼
  Server: "btw" handler
        │  1. Snapshot conversation history from agent.store
        │  2. Frame question with side-question prompt
        │  3. Call LLMClient.stream() with empty tools
        │  4. Stream response via btw_content / btw_done notifications
        │
        ▼
  Client: handle btw_content / btw_done notifications
        │  Dispatch to eventHandler
        │
        ▼
  TUI: App updates btwItem state
        │  BtwMessage component renders the overlay
        │  Dismiss clears btwItem state
```

---

## Phase 1: Server-Side `/btw` Handler

### 1.1 JSON-RPC method

Add a `"btw"` case in `server/index.ts`'s `handleRequest`:

```typescript
case "btw": {
    if (!agent) {
        sendError(requestId, -32002, "Not initialized")
        return
    }

    const { message } = params as { message: string }
    if (!message?.trim()) {
        sendError(requestId, -32602, "message is required")
        return
    }

    // Snapshot conversation history
    const history = agent.getStoreMessages()

    // Frame as side question
    const framedMessage = `[Side question — answer briefly and concisely. This is a "by the way" question that should not be part of the main conversation.]\n\n${message}`

    // Get LLM client config from agent snapshot
    const snapshot = agent.getConfigSnapshot()
    const llm = new LLMClient({
        provider: snapshot.provider,
        model: snapshot.model,
        apiKey: snapshot.apiKey,
        baseURL: snapshot.baseURL,
        debug: snapshot.debug,
    })

    // Stream response with no tools
    const stream = llm.stream(
        convertToolMessages(truncateMessages(history)),
        {},  // no tools
    )

    // Fire-and-forget streaming
    ;(async () => {
        try {
            for await (const event of stream) {
                if (event.type === "content") {
                    sendNotification("btw_content", { delta: event.delta })
                } else if (event.type === "done") {
                    sendNotification("btw_done", { finishReason: event.finishReason })
                }
                // Ignore reasoning, tool_call events (no tools = no tool calls)
            }
        } catch (error: any) {
            sendNotification("btw_done", { finishReason: `error: ${error.message}` })
        }
        sendResponse(requestId, {})
    })()
    break
}
```

### 1.2 Expose store messages from Agent

Add a public method to `Agent` for reading store content:

```typescript
// src/server/agent.ts
getStoreMessages(): CoreMessage[] {
    return this.store.getAll()
}
```

This is needed for the server handler to snapshot history.

**Files:** `src/server/index.ts`, `src/server/agent.ts`

---

## Phase 2: Client-Side Support

### 2.1 New event types

Add `btw_content` and `btw_done` to `ClientEvent` union:

```typescript
// src/client/index.ts
export type ClientEvent =
    | ... existing ...
    | { type: "btw_content"; delta: string }
    | { type: "btw_done"; finishReason: string }
```

### 2.2 Client method

```typescript
async btw(message: string): Promise<void> {
    await this.sendRequest("btw", { message })
}
```

### 2.3 Handle notifications

Add cases in `handleNotification`:

```typescript
case "btw_content":
    this.eventHandler({ type: "btw_content", delta: p.delta })
    break
case "btw_done":
    this.eventHandler({ type: "btw_done", finishReason: p.finishReason })
    break
```

**Files:** `src/client/index.ts`

---

## Phase 3: TUI Integration

### 3.1 btwItem state

Add dedicated btw state to `App.tsx`:

```typescript
interface BtwItem {
    question: string
    answer: string
    isStreaming: boolean
}

const [btwItem, setBtwItem] = useState<BtwItem | null>(null)
```

### 3.2 Handle btw events

In `handleEvent`, add cases:

```typescript
case 'btw_content':
    setBtwItem(prev => prev ? { ...prev, answer: prev.answer + event.delta } : null)
    break
case 'btw_done':
    setBtwItem(prev => prev ? { ...prev, isStreaming: false } : null)
    break
```

### 3.3 BtwMessage component

Create `src/tui/components/BtwMessage.tsx` — a simple overlay:

```
┌─ /btw ─────────────────────────────────────────┐
│ Q: what's the difference between HS256 and RS256│
│                                                 │
│ A: HS256 uses a shared secret, RS256 uses       │
│    public/private key pair...                    │
│                                                 │
│ Press Space/Enter/Escape to dismiss             │
└─────────────────────────────────────────────────┘
```

Pending state shows "Answering..." with the streaming answer. Completed state shows the full answer with dismiss hint.

### 3.4 Cancel /btw

- New `/btw` cancels previous in-flight one (reset `btwItem` state)
- ESC key during btw streaming calls `client.interrupt()` which aborts the server-side stream
- The server's btw handler needs a dedicated `AbortController` (`btwAbortController`) stored alongside `currentAbortController`, so interrupting the main agent loop doesn't affect btw and vice versa
- Add `"interrupt_btw"` JSON-RPC method that aborts `btwAbortController`

### 3.5 Dismiss

- Space, Enter, or Escape (when not streaming) clears `btwItem`
- Integrate with `useInputBuffer` or `InputBox` key handler

### 3.6 Render placement

Render `BtwMessage` between the message list and the input box, only when `btwItem` is not null.

**Files:** `src/tui/App.tsx`, `src/tui/components/BtwMessage.tsx`, `src/tui/types.ts`

---

## Phase 4: `/btw` Slash Command

### 4.1 Command registration

Create `src/commands/builtin/btwCommand.ts`:

```typescript
export const btwCommand: SlashCommand = {
    name: 'btw',
    description: 'Ask a side question without affecting conversation history',
    kind: CommandKind.BUILT_IN,
    action: (context: CommandContext, args: string): SlashCommandActionReturn => {
        if (!args.trim()) {
            return { type: 'message', content: 'Usage: /btw <question>' }
        }
        // Return special type to trigger btw flow in App
        return { type: 'btw', question: args.trim() }
    },
}
```

### 4.2 Extend SlashCommandActionReturn

Add a new return type:

```typescript
export type SlashCommandActionReturn =
    | { type: 'message'; content: string; isError?: boolean }
    | { type: 'quit' }
    | { type: 'submit_prompt'; content: string }
    | { type: 'btw'; question: string }  // ← new
    | void
```

### 4.3 Handle in App.tsx

In `handleSubmit`, add a case for `'btw'`:

```typescript
case 'btw':
    if (!client) return
    // Cancel any existing btw
    if (btwItem?.abortController) btwItem.abortController.abort()
    setBtwItem({
        question: result.question,
        answer: '',
        isStreaming: true,
        abortController: null,  // cancellation managed server-side
    })
    client.btw(result.question).catch(err => {
        setBtwItem(prev => prev ? { ...prev, isStreaming: false, answer: prev.answer || `Error: ${err.message}` } : null)
    })
    break
```

**Files:** `src/commands/builtin/btwCommand.ts`, `src/commands/builtin/index.ts`, `src/commands/types.ts`, `src/tui/App.tsx`

---

## Implementation Order

| Phase | Effort | Value | Priority |
|---|---|---|---|
| 1 — Server handler | S (1h) | Core | **P0** |
| 2 — Client support | S (30m) | Core | **P0** |
| 3 — TUI integration | M (2h) | Core | **P0** |
| 4 — Slash command | S (30m) | Core | **P0** |

All four phases are needed for the MVP. The feature is not usable without the TUI overlay.

---

## Key Reuse from Existing Code

| New need | Reuse from |
|---|---|
| LLM streaming call | `LLMClient.stream()` with empty tools |
| Conversation snapshot | `agent.store.getAll()` (new public accessor) |
| JSON-RPC streaming | Existing `sendNotification` pattern |
| Slash command structure | Any existing command in `src/commands/builtin/` |
| Message truncation | `truncateMessages()` from `src/server/utils/` |

---

## File Structure After Implementation

```
src/commands/builtin/
  btwCommand.ts          ← /btw command

src/tui/components/
  BtwMessage.tsx         ← btw overlay component
```

No new server-side files needed — the btw handler goes in the existing `server/index.ts`.

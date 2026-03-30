import type { CoreMessage } from "ai"

/**
 * Normalise the message history for providers that don't support the
 * structured tool-call / tool-result content-block format (e.g. GLM, Kimi).
 *
 * Two transformations are applied:
 *
 * 1. role:"tool" → role:"user" with plain-text content.
 *    Tool results become readable user messages so every provider can process
 *    them without needing native tool-result support.
 *
 * 2. role:"assistant" with tool-call parts → strip tool-call parts, keep text.
 *    When a model emits text AND tool calls in the same turn, the assistant
 *    message has mixed content [text_part, tool_call_part]. After rule (1)
 *    converts the following tool message to role:"user", the API sees an
 *    assistant message that still contains tool-call parts but is not followed
 *    by role:"tool" — which triggers error 2013 ("tool call result does not
 *    follow tool call"). Stripping the tool-call parts (while keeping text)
 *    produces a clean assistant(text) → user(result) sequence that every
 *    provider accepts.
 *
 *    NOTE: we strip — not replace with [Called ...] text — to avoid the model
 *    mimicking that format in subsequent turns.
 */
export function convertToolMessages(messages: CoreMessage[]): CoreMessage[] {
    const result: CoreMessage[] = []
    for (const msg of messages) {
        if (msg.role === "tool") {
            // Rule 1: flatten tool-result parts into a readable user message
            const parts = Array.isArray(msg.content) ? msg.content : []
            const text = parts
                .map((p: any) => {
                    if (p.type === "tool-result") {
                        const body = typeof p.result === "string" ? p.result : JSON.stringify(p.result)
                        return `[Tool Result: ${p.toolName}]\n${body}`
                    }
                    return JSON.stringify(p)
                })
                .join("\n\n")
            result.push({ role: "user", content: text })
        } else if (msg.role === "assistant" && Array.isArray(msg.content)) {
            // Rule 2: strip tool-call parts, keep text parts only
            const textParts = (msg.content as any[]).filter((p: any) => p.type !== "tool-call")
            const text = textParts.map((p: any) => p.text ?? "").join("")
            // Always emit the assistant turn (even empty) to avoid user→user adjacency
            result.push({ role: "assistant", content: text })
        } else {
            result.push(msg)
        }
    }
    return result
}

/** Conservative estimate: ~3.5 chars per token for mixed code/text */
export const CHARS_PER_TOKEN = 3.5

/** Leave room for system prompt, tool definitions, and model response */
export const DEFAULT_MAX_TOKENS = 100_000

export function estimateTokens(msg: CoreMessage): number {
    const text = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content)
    return Math.ceil(text.length / CHARS_PER_TOKEN)
}

/** Estimate total tokens for a batch of messages. */
export function estimateTotalTokens(messages: CoreMessage[]): number {
    return messages.reduce((s, m) => s + estimateTokens(m), 0)
}

/**
 * Groups messages into atomic "turns" that must not be split.
 * Each turn starts with an assistant message, followed by any tool result
 * messages that respond to its tool calls. Tool calls and their results
 * must always travel together, or the API will reject the message sequence.
 *
 * Example input:  [assistant(tool-call A), tool-result A, assistant(text)]
 * Example output: [[assistant(tool-call A), tool-result A], [assistant(text)]]
 */
function groupIntoTurns(messages: CoreMessage[]): CoreMessage[][] {
    const turns: CoreMessage[][] = []
    let current: CoreMessage[] = []
    for (const msg of messages) {
        if (msg.role === "assistant") {
            if (current.length > 0) turns.push(current)
            current = [msg]
        } else {
            current.push(msg)
        }
    }
    if (current.length > 0) turns.push(current)
    return turns
}

/**
 * Truncates the message history to fit within maxTokens.
 * Always preserves the first message (original user task).
 * Drops oldest turns first to keep the most recent context.
 */
export function truncateMessages(
    messages: CoreMessage[],
    maxTokens = DEFAULT_MAX_TOKENS,
): CoreMessage[] {
    if (messages.length === 0) return messages

    const total = estimateTotalTokens(messages)
    if (total <= maxTokens) return messages

    // The first message (initial user prompt) is always preserved
    const [first, ...rest] = messages
    const turns = groupIntoTurns(rest)

    // Drop oldest turns until the history fits
    while (turns.length > 1) {
        const current = [first, ...turns.flat()]
        if (estimateTotalTokens(current) <= maxTokens) break
        turns.shift()
    }

    return [first, ...turns.flat()]
}

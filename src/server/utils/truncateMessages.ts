import type { CoreMessage } from "ai"

/**
 * Convert role:"tool" messages to role:"user" with plain-text content.
 * Some Anthropic-compatible endpoints (e.g. glm) don't fully support the
 * `tool_result` content-block format and reject messages that reference tools.
 * By converting to plain user text, the tool results still reach the model
 * as context without requiring provider-side tool-result support.
 */
export function convertToolMessages(messages: CoreMessage[]): CoreMessage[] {
    const result: CoreMessage[] = []
    for (const msg of messages) {
        if (msg.role !== "tool") {
            result.push(msg)
            continue
        }
        // Flatten tool-result parts into readable text
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
    }
    return result
}

/** Conservative estimate: ~3.5 chars per token for mixed code/text */
const CHARS_PER_TOKEN = 3.5

/** Leave room for system prompt, tool definitions, and model response */
export const DEFAULT_MAX_TOKENS = 100_000

export function estimateTokens(msg: CoreMessage): number {
    const text = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content)
    return Math.ceil(text.length / CHARS_PER_TOKEN)
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

    const total = messages.reduce((sum, m) => sum + estimateTokens(m), 0)
    if (total <= maxTokens) return messages

    // The first message (initial user prompt) is always preserved
    const [first, ...rest] = messages
    const turns = groupIntoTurns(rest)

    // Drop oldest turns until the history fits
    while (turns.length > 1) {
        const current = [first, ...turns.flat()]
        if (current.reduce((sum, m) => sum + estimateTokens(m), 0) <= maxTokens) break
        turns.shift()
    }

    return [first, ...turns.flat()]
}

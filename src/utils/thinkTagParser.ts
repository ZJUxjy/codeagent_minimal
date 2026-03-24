/**
 * Streaming state machine for parsing thinking tags.
 * Used for MiniMax, DeepSeek, Qwen and other models that output thinking
 * content through OpenAI-compatible APIs.
 */

export type ThinkParseEvent =
    | { type: "reasoning"; delta: string }
    | { type: "content"; delta: string }
    | { type: "reasoning_end" }

export interface ThinkTagParser {
    feed(text: string): ThinkParseEvent[]
    reset(): void
    isInThink(): boolean
    flush(): ThinkParseEvent[]
}

const THINK_OPEN = "<think>"
const THINK_CLOSE = "</think>"

export function createThinkTagParser(): ThinkTagParser {
    let inThink = false
    let buffer = ""

    /** Check if buffer ends with a partial prefix of target */
    function findPossiblePrefix(text: string, target: string): number {
        for (let len = Math.min(target.length - 1, text.length); len >= 1; len--) {
            if (text.endsWith(target.slice(0, len))) {
                return text.length - len
            }
        }
        return -1
    }

    /**
     * Search for tag in buffer and emit content before it.
     * Returns "found" (tag consumed), "continue" (partial content emitted), or
     * "wait" (insufficient data).
     */
    function consumeUntilTag(
        tag: string,
        emitType: "reasoning" | "content",
        events: ThinkParseEvent[],
    ): "found" | "continue" | "wait" {
        const idx = buffer.indexOf(tag)
        if (idx !== -1) {
            if (idx > 0) {
                events.push({ type: emitType, delta: buffer.slice(0, idx) })
            }
            buffer = buffer.slice(idx + tag.length)
            return "found"
        }

        // Tag not found, check if buffer ends with partial tag prefix
        const prefixPos = findPossiblePrefix(buffer, tag)
        if (prefixPos > 0) {
            events.push({ type: emitType, delta: buffer.slice(0, prefixPos) })
            buffer = buffer.slice(prefixPos)
            return "continue"
        }
        if (prefixPos === -1 && buffer.length > tag.length) {
            // Keep last (tag.length-1) chars to handle tags spanning chunks
            const safeLen = buffer.length - tag.length + 1
            events.push({ type: emitType, delta: buffer.slice(0, safeLen) })
            buffer = buffer.slice(safeLen)
            return "continue"
        }
        return "wait"
    }

    function feed(text: string): ThinkParseEvent[] {
        const events: ThinkParseEvent[] = []
        buffer += text

        while (buffer.length > 0) {
            if (inThink) {
                const result = consumeUntilTag(THINK_CLOSE, "reasoning", events)
                if (result === "found") {
                    events.push({ type: "reasoning_end" })
                    inThink = false
                } else if (result === "wait") {
                    break
                }
            } else {
                const result = consumeUntilTag(THINK_OPEN, "content", events)
                if (result === "found") {
                    inThink = true
                } else if (result === "wait") {
                    break
                }
            }
        }

        return events
    }

    function flush(): ThinkParseEvent[] {
        const events: ThinkParseEvent[] = []
        if (buffer.length > 0) {
            events.push(
                inThink
                    ? { type: "reasoning", delta: buffer }
                    : { type: "content", delta: buffer },
            )
            if (inThink) events.push({ type: "reasoning_end" })
            buffer = ""
        }
        return events
    }

    return {
        feed,
        reset(): void {
            inThink = false
            buffer = ""
        },
        isInThink(): boolean {
            return inThink
        },
        flush,
    }
}

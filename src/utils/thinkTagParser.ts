/**
 * 解析 `<think>...</think>` 标签的流式状态机。
 * 用于 MiniMax、DeepSeek、Qwen 等通过 OpenAI 兼容接口输出思考内容的模型。
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

    /** 检查 buffer 末尾是否可能是 target 的不完整前缀 */
    function findPossiblePrefix(text: string, target: string): number {
        for (let len = Math.min(target.length - 1, text.length); len >= 1; len--) {
            if (text.endsWith(target.slice(0, len))) {
                return text.length - len
            }
        }
        return -1
    }

    /**
     * 在 buffer 中搜索 tag，将 tag 之前的内容以 emitType 发射出去。
     * 返回 "found"（标签已消费）、"continue"（部分内容已发射，继续循环）
     * 或 "wait"（数据不足，需要更多输入）。
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

        // 标签未找到，检查 buffer 尾部是否是标签的不完整前缀
        const prefixPos = findPossiblePrefix(buffer, tag)
        if (prefixPos > 0) {
            events.push({ type: emitType, delta: buffer.slice(0, prefixPos) })
            buffer = buffer.slice(prefixPos)
            return "continue"
        }
        if (prefixPos === -1 && buffer.length > tag.length) {
            // 保留末尾 tag.length-1 个字符以应对跨 chunk 的标签
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
        reset() { inThink = false; buffer = "" },
        isInThink() { return inThink },
        flush,
    }
}

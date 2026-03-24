/**
 * 解析 <think>...</think> 标签的状态机
 * 用于处理 MiniMax、DeepSeek、Qwen 等模型输出的思考内容
 */

export type ThinkParseEvent =
    | { type: "reasoning"; delta: string }
    | { type: "content"; delta: string }
    | { type: "reasoning_end" }

export interface ThinkTagParser {
    /** 处理输入文本，返回解析后的事件 */
    feed(text: string): ThinkParseEvent[]
    /** 重置解析器状态 */
    reset(): void
    /** 获取当前是否在思考标签内 */
    isInThink(): boolean
    /** 刷新剩余内容（流结束时调用） */
    flush(): ThinkParseEvent[]
}

const THINK_OPEN = "<think>"
const THINK_CLOSE = "</think>"

/**
 * 创建思考标签解析器
 * 处理 <think>...</think> 格式的思考内容
 */
export function createThinkTagParser(): ThinkTagParser {
    let inThink = false
    let buffer = ""

    function findPossiblePrefix(text: string, target: string): number {
        // 检查文本末尾是否可能是 target 的前缀
        for (let len = Math.min(target.length - 1, text.length); len >= 1; len--) {
            if (text.endsWith(target.slice(0, len))) {
                return text.length - len
            }
        }
        return -1
    }

    function feed(text: string): ThinkParseEvent[] {
        const events: ThinkParseEvent[] = []
        buffer += text

        while (buffer.length > 0) {
            if (inThink) {
                // 在思考标签内，寻找结束标签
                const closeIdx = buffer.indexOf(THINK_CLOSE)
                if (closeIdx !== -1) {
                    // 找到结束标签
                    if (closeIdx > 0) {
                        events.push({ type: "reasoning", delta: buffer.slice(0, closeIdx) })
                    }
                    events.push({ type: "reasoning_end" })
                    buffer = buffer.slice(closeIdx + THINK_CLOSE.length)
                    inThink = false
                } else {
                    // 没找到完整的结束标签，检查是否有部分前缀
                    const prefixPos = findPossiblePrefix(buffer, THINK_CLOSE)
                    if (prefixPos > 0) {
                        // 输出确定不是标签的部分
                        events.push({ type: "reasoning", delta: buffer.slice(0, prefixPos) })
                        buffer = buffer.slice(prefixPos)
                    } else if (prefixPos === -1 && buffer.length > THINK_CLOSE.length) {
                        // 完全没有可能的标签前缀，全部输出（保留最后几个字符以防万一）
                        const safeLen = buffer.length - THINK_CLOSE.length + 1
                        events.push({ type: "reasoning", delta: buffer.slice(0, safeLen) })
                        buffer = buffer.slice(safeLen)
                    } else {
                        break // 等待更多数据
                    }
                }
            } else {
                // 不在思考标签内，寻找开始标签
                const openIdx = buffer.indexOf(THINK_OPEN)
                if (openIdx !== -1) {
                    // 找到开始标签
                    if (openIdx > 0) {
                        events.push({ type: "content", delta: buffer.slice(0, openIdx) })
                    }
                    buffer = buffer.slice(openIdx + THINK_OPEN.length)
                    inThink = true
                } else {
                    // 没找到完整的开始标签，检查是否有部分前缀
                    const prefixPos = findPossiblePrefix(buffer, THINK_OPEN)
                    if (prefixPos > 0) {
                        // 输出确定不是标签的部分
                        events.push({ type: "content", delta: buffer.slice(0, prefixPos) })
                        buffer = buffer.slice(prefixPos)
                    } else if (prefixPos === -1 && buffer.length > THINK_OPEN.length) {
                        // 完全没有可能的标签前缀，全部输出（保留最后几个字符）
                        const safeLen = buffer.length - THINK_OPEN.length + 1
                        events.push({ type: "content", delta: buffer.slice(0, safeLen) })
                        buffer = buffer.slice(safeLen)
                    } else {
                        break // 等待更多数据
                    }
                }
            }
        }

        return events
    }

    function reset(): void {
        inThink = false
        buffer = ""
    }

    function flush(): ThinkParseEvent[] {
        const events: ThinkParseEvent[] = []
        if (buffer.length > 0) {
            if (inThink) {
                events.push({ type: "reasoning", delta: buffer })
                events.push({ type: "reasoning_end" })
            } else {
                events.push({ type: "content", delta: buffer })
            }
            buffer = ""
        }
        return events
    }

    function isInThink(): boolean {
        return inThink
    }

    return { feed, reset, isInThink, flush }
}

/**
 * Markdown 安全分割工具
 * 用于在流式输出时找到安全的分割点，避免破坏 Markdown 结构
 */

/**
 * 找到包含指定位置的代码块的起始位置
 * @param content 内容字符串
 * @param position 要检查的位置
 * @returns 如果在代码块内，返回代码块起始位置；否则返回 -1
 */
export const findEnclosingCodeBlockStart = (
    content: string,
    position: number,
): number => {
    let inCodeBlock = false
    let codeBlockStart = -1
    let i = 0

    while (i < position) {
        if (content.slice(i, i + 3) === "```") {
            if (!inCodeBlock) {
                codeBlockStart = i
            }
            inCodeBlock = !inCodeBlock
            // 跳过整个 ``` 标记
            i += 3
            // 跳过可能的语言标识符行
            while (i < position && content[i] !== "\n") {
                i++
            }
            continue
        }
        i++
    }

    return inCodeBlock ? codeBlockStart : -1
}

/**
 * 找到最后一个安全分割点
 * 优先级：代码块边界 > 双换行 > 单换行 > 不分割
 *
 * @param content 要分割的内容
 * @returns 安全分割点的位置（可以在该位置切分）
 */
export const findLastSafeSplitPoint = (content: string): number => {
    if (content.length === 0) {
        return 0
    }

    // 1. 检查末尾是否在代码块内
    const codeBlockStart = findEnclosingCodeBlockStart(content, content.length)
    if (codeBlockStart !== -1) {
        // 在代码块内，在代码块开始处切分
        return codeBlockStart
    }

    // 2. 查找最后一个双换行（不在代码块内）
    let lastDoubleNewline = -1
    let inCodeBlock = false
    let i = 0

    while (i < content.length - 1) {
        if (content.slice(i, i + 3) === "```") {
            inCodeBlock = !inCodeBlock
            i += 3
            continue
        }
        if (!inCodeBlock && content.slice(i, i + 2) === "\n\n") {
            lastDoubleNewline = i
        }
        i++
    }

    if (lastDoubleNewline !== -1) {
        return lastDoubleNewline + 2 // 返回双换行后的位置
    }

    // 3. 查找最后一个单换行（不在代码块内）
    inCodeBlock = false
    i = 0
    let lastNewline = -1

    while (i < content.length) {
        if (content.slice(i, i + 3) === "```") {
            inCodeBlock = !inCodeBlock
            i += 3
            continue
        }
        if (!inCodeBlock && content[i] === "\n") {
            lastNewline = i
        }
        i++
    }

    if (lastNewline !== -1) {
        return lastNewline + 1
    }

    // 4. 没有安全分割点，不分割
    return content.length
}

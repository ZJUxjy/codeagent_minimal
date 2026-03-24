export type MarkdownSegment =
    | { type: "prose"; text: string }
    | { type: "code"; lang?: string; code: string }

/**
 * 将 Markdown 正文按 ``` 围栏拆成「普通文本」与「代码块」
 * 未闭合的 ``` 视为普通文本，不破坏整段显示
 */
export function splitFencedCodeBlocks(content: string): MarkdownSegment[] {
    const segments: MarkdownSegment[] = []
    let cursor = 0

    while (cursor < content.length) {
        const fenceStart = content.indexOf("```", cursor)
        if (fenceStart === -1) {
            const rest = content.slice(cursor)
            if (rest) {
                segments.push({ type: "prose", text: rest })
            }
            break
        }

        if (fenceStart > cursor) {
            segments.push({
                type: "prose",
                text: content.slice(cursor, fenceStart),
            })
        }

        const afterTicks = fenceStart + 3
        const lineEnd = content.indexOf("\n", afterTicks)
        if (lineEnd === -1) {
            segments.push({ type: "prose", text: content.slice(fenceStart) })
            break
        }

        const langLine = content.slice(afterTicks, lineEnd).trim()
        const lang = langLine || undefined
        const codeStart = lineEnd + 1
        const fenceEnd = content.indexOf("```", codeStart)
        if (fenceEnd === -1) {
            segments.push({ type: "prose", text: content.slice(fenceStart) })
            break
        }

        let code = content.slice(codeStart, fenceEnd)
        if (code.endsWith("\n")) {
            code = code.slice(0, -1)
        }
        if (code.endsWith("\r")) {
            code = code.slice(0, -1)
        }

        segments.push({ type: "code", lang, code })

        cursor = fenceEnd + 3
        if (content[cursor] === "\r") cursor++
        if (content[cursor] === "\n") cursor++
    }

    if (segments.length === 0) {
        return [{ type: "prose", text: content }]
    }

    return segments
}

/**
 * 将围栏外的 Markdown 正文拆成块级结构，供终端渲染
 */

export type RenderableBlock =
    | { type: "heading"; level: number; text: string }
    | { type: "paragraph"; text: string }
    | { type: "hr" }
    | { type: "ul"; items: string[] }
    | { type: "ol"; items: string[] }
    | { type: "table"; rows: string[] }
    | { type: "blockquote"; lines: string[] }

function isTableBlock(lines: string[]): boolean {
    const content = lines.filter((l) => l.trim().length > 0)
    if (content.length < 2) return false
    return content.every((l) => /^\s*\|/.test(l))
}

function isListBlock(lines: string[]): "ul" | "ol" | null {
    const content = lines.filter((l) => l.trim().length > 0)
    if (content.length === 0) return null
    const ul = content.every((l) => /^\s*[-*]\s+/.test(l))
    if (ul) return "ul"
    const ol = content.every((l) => /^\s*\d+\.\s+/.test(l))
    if (ol) return "ol"
    return null
}

function isBlockquote(lines: string[]): boolean {
    const content = lines.filter((l) => l.trim().length > 0)
    return (
        content.length > 0 &&
        content.every((l) => /^\s*>/.test(l))
    )
}

function classifyChunk(chunk: string): RenderableBlock[] {
    const rawLines = chunk.split("\n")
    const lines = rawLines

    const firstTrim = lines[0]?.trimStart() ?? ""

    // 分隔线
    if (
        lines.length === 1 &&
        /^(-{3,}|\*{3,}|_{3,})\s*$/.test(firstTrim)
    ) {
        return [{ type: "hr" }]
    }

    // 标题（首行 #；后续行并入同块时当作正文段落）
    if (/^#{1,6}\s+/.test(firstTrim)) {
        const m = firstTrim.match(/^(#{1,6})\s+(.*)$/)
        if (m) {
            const level = m[1].length
            const title = m[2].trim()
            const rest = lines
                .slice(1)
                .join("\n")
                .trim()
            const out: RenderableBlock[] = [
                { type: "heading", level, text: title },
            ]
            if (rest) {
                out.push({ type: "paragraph", text: rest })
            }
            return out
        }
    }

    if (isTableBlock(lines)) {
        return [
            {
                type: "table",
                rows: lines.filter((l) => l.trim().length > 0),
            },
        ]
    }

    const listKind = isListBlock(lines)
    if (listKind === "ul") {
        const items = lines
            .filter((l) => l.trim())
            .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
        return [{ type: "ul", items }]
    }
    if (listKind === "ol") {
        const items = lines
            .filter((l) => l.trim())
            .map((l) => l.replace(/^\s*\d+\.\s+/, "").trim())
        return [{ type: "ol", items }]
    }

    if (isBlockquote(lines)) {
        const qlines = lines
            .filter((l) => l.trim())
            .map((l) => l.replace(/^\s*>\s?/, ""))
        return [{ type: "blockquote", lines: qlines }]
    }

    return [{ type: "paragraph", text: chunk }]
}

/**
 * 按空行分段，再识别标题 / 列表 / 表格 / 引用等
 */
export function splitProseIntoBlocks(prose: string): RenderableBlock[] {
    const trimmed = prose.replace(/\r\n/g, "\n")
    const chunks = trimmed
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)

    if (chunks.length === 0) {
        return trimmed.length > 0
            ? [{ type: "paragraph", text: trimmed }]
            : []
    }

    const out: RenderableBlock[] = []
    for (const chunk of chunks) {
        out.push(...classifyChunk(chunk))
    }
    return out
}

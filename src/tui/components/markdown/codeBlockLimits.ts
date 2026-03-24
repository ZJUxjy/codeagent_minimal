/**
 * 代码块展示上限，避免终端与 lowlight 处理臃肿输出
 * 可按需改大/改小
 */
export const CODE_BLOCK_MAX_LINES = 48
export const CODE_BLOCK_MAX_CHARS = 12_000

export interface TruncatedCodePreview {
    /** 送入高亮的正文 */
    display: string
    /** 原文换行数（\n 分割） */
    totalLines: number
    /** 因行数被裁掉的行数 */
    omittedLines: number
    /** 是否在行裁剪后又触发了字符上限 */
    charCapHit: boolean
}

/**
 * 先按行数取前 N 行，再按字符数硬截断（防单行巨 JSON）
 */
export function truncateCodeForDisplay(raw: string): TruncatedCodePreview {
    const normalized = raw.replace(/\r\n/g, "\n")
    const allLines = normalized.split("\n")
    const totalLines = allLines.length

    let body = allLines.slice(0, CODE_BLOCK_MAX_LINES).join("\n")
    const omittedLines = Math.max(0, totalLines - CODE_BLOCK_MAX_LINES)

    let charCapHit = false
    if (body.length > CODE_BLOCK_MAX_CHARS) {
        body = body.slice(0, CODE_BLOCK_MAX_CHARS)
        charCapHit = true
    }

    return {
        display: body,
        totalLines,
        omittedLines,
        charCapHit,
    }
}

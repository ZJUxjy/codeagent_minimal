import { common, createLowlight } from "lowlight"
import type { Root } from "hast"

export const lowlight = createLowlight(common)

/** 常见别名 → lowlight / highlight.js 注册名 */
const LANG_ALIASES: Record<string, string> = {
    js: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    py: "python",
    rb: "ruby",
    sh: "bash",
    shell: "bash",
    zsh: "bash",
    yml: "yaml",
    md: "markdown",
    mkd: "markdown",
    rs: "rust",
    go: "go",
    fs: "fsharp",
    cs: "csharp",
    cpp: "cpp",
    cxx: "cpp",
    cc: "cpp",
    h: "cpp",
    kt: "kotlin",
    kts: "kotlin",
}

export function normalizeFenceLang(raw: string | undefined): string | undefined {
    if (!raw?.trim()) return undefined
    const k = raw.trim().toLowerCase()
    return LANG_ALIASES[k] ?? k
}

/**
 * 返回 lowlight HAST；失败时 null（调用方回退单色）
 */
export function highlightToHast(
    fenceLang: string | undefined,
    code: string,
): Root | null {
    const trimmed = code.replace(/\r\n/g, "\n")
    if (!trimmed) return null

    const lang = normalizeFenceLang(fenceLang)

    try {
        if (lang && lowlight.registered(lang)) {
            return lowlight.highlight(lang, trimmed)
        }
        return lowlight.highlightAuto(trimmed, {
            subset: lowlight.listLanguages(),
        })
    } catch {
        return null
    }
}

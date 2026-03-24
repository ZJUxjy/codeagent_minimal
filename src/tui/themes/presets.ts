import type { LopTheme, ThemeId } from "./types.js"
import { ansiPalette, qwenDarkPalette, qwenLightPalette } from "./palettes.js"
import { semanticFromPalette } from "./semanticFromPalette.js"

export const themes: Record<ThemeId, LopTheme> = {
    "dark": {
        id: "dark",
        name: "Dark",
        type: "dark",
        colors: semanticFromPalette(qwenDarkPalette),
    },
    "light": {
        id: "light",
        name: "Light",
        type: "light",
        colors: semanticFromPalette(qwenLightPalette),
    },
    ansi: {
        id: "ansi",
        name: "ANSI",
        type: "ansi",
        colors: semanticFromPalette(ansiPalette),
    },
}

export const defaultThemeId: ThemeId = "dark"

const KNOWN = new Set<ThemeId>(["dark", "light", "ansi"])

export function resolveThemeId(raw: string | undefined): ThemeId {
    if (raw && KNOWN.has(raw as ThemeId)) {
        return raw as ThemeId
    }
    return defaultThemeId
}

/** 解析用户输入的内置主题 id；非法则 undefined */
export function tryParseThemeId(raw: string): ThemeId | undefined {
    const t = raw.trim()
    return KNOWN.has(t as ThemeId) ? (t as ThemeId) : undefined
}

/** 内置主题列表（供 /theme 与帮助展示） */
export function listBuiltinThemes(): Array<{ id: ThemeId; displayName: string }> {
    return (Object.keys(themes) as ThemeId[]).map((id) => ({
        id,
        displayName: themes[id].name,
    }))
}

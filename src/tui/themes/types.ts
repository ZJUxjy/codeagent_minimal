/**
 * 语义色与主题 ID（精简自 code CLI themes 思路）
 */

export type ThemeId = "dark" | "light" | "ansi"

/** 与 code semantic-tokens 对齐的语义色，供 Ink（hex / 命名色）使用 */
export interface SemanticColors {
    text: {
        primary: string
        secondary: string
        link: string
        accent: string
        code: string
    }
    background: {
        primary: string
        diff: { added: string; removed: string }
    }
    border: {
        default: string
        focused: string
    }
    ui: {
        comment: string
        symbol: string
        gradient: string[] | undefined
    }
    status: {
        error: string
        success: string
        warning: string
        errorDim: string
        warningDim: string
    }
}

export interface LopTheme {
    id: ThemeId
    name: string
    type: "light" | "dark" | "ansi"
    colors: SemanticColors
}

/** 与 code ColorsTheme 对齐的调色板（仅数值，不含 hljs 映射） */
export interface ColorPalette {
    Background: string
    Foreground: string
    LightBlue: string
    AccentBlue: string
    AccentPurple: string
    AccentCyan: string
    AccentGreen: string
    AccentYellow: string
    AccentRed: string
    AccentYellowDim: string
    AccentRedDim: string
    DiffAdded: string
    DiffRemoved: string
    Comment: string
    Gray: string
    GradientColors?: string[]
}

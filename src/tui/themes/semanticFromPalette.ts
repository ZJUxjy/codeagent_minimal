import type { ColorPalette, SemanticColors } from "./types.js"

/** 由调色板生成语义 token（对齐 code Theme 构造时的默认映射） */
export function semanticFromPalette(p: ColorPalette): SemanticColors {
    return {
        text: {
            primary: p.Foreground,
            secondary: p.Gray,
            link: p.AccentBlue,
            accent: p.AccentPurple,
            code: p.LightBlue,
        },
        background: {
            primary: p.Background,
            diff: {
                added: p.DiffAdded,
                removed: p.DiffRemoved,
            },
        },
        border: {
            default: p.Gray,
            focused: p.AccentBlue,
        },
        ui: {
            comment: p.Comment,
            symbol: p.AccentCyan,
            gradient: p.GradientColors,
        },
        status: {
            error: p.AccentRed,
            success: p.AccentGreen,
            warning: p.AccentYellow,
            errorDim: p.AccentRedDim,
            warningDim: p.AccentYellowDim,
        },
    }
}

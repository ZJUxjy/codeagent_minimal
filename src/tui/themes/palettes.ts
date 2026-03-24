/**
 * 调色板数值来自 code (Apache-2.0)
 * packages/cli/src/ui/themes/dark.ts, light.ts, theme.ts (ansiTheme)
 */
import type { ColorPalette } from "./types.js"

export const qwenDarkPalette: ColorPalette = {
    Background: "#0b0e14",
    Foreground: "#bfbdb6",
    LightBlue: "#59C2FF",
    AccentBlue: "#39BAE6",
    AccentPurple: "#D2A6FF",
    AccentCyan: "#95E6CB",
    AccentGreen: "#AAD94C",
    AccentYellow: "#FFD700",
    AccentRed: "#F26D78",
    AccentYellowDim: "#8B7530",
    AccentRedDim: "#8B3A4A",
    DiffAdded: "#AAD94C",
    DiffRemoved: "#F26D78",
    Comment: "#646A71",
    Gray: "#3D4149",
    GradientColors: ["#FFD700", "#da7959"],
}

export const qwenLightPalette: ColorPalette = {
    Background: "#f8f9fa",
    Foreground: "#5c6166",
    LightBlue: "#55b4d4",
    AccentBlue: "#399ee6",
    AccentPurple: "#a37acc",
    AccentCyan: "#4cbf99",
    AccentGreen: "#86b300",
    AccentYellow: "#f2ae49",
    AccentRed: "#f07171",
    AccentYellowDim: "#8B7000",
    AccentRedDim: "#993333",
    DiffAdded: "#86b300",
    DiffRemoved: "#f07171",
    Comment: "#ABADB1",
    Gray: "#CCCFD3",
    GradientColors: ["#399ee6", "#86b300"],
}

/** 仅 16 色命名，兼容 NO_COLOR 环境 */
export const ansiPalette: ColorPalette = {
    Background: "black",
    Foreground: "white",
    LightBlue: "blue",
    AccentBlue: "blue",
    AccentPurple: "magenta",
    AccentCyan: "cyan",
    AccentGreen: "green",
    AccentYellow: "yellow",
    AccentRed: "red",
    AccentYellowDim: "yellow",
    AccentRedDim: "red",
    DiffAdded: "green",
    DiffRemoved: "red",
    Comment: "gray",
    Gray: "gray",
}

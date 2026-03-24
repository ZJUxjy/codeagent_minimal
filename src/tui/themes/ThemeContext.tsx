import React, { createContext, useContext, useMemo } from "react"
import { defaultThemeId, resolveThemeId, themes } from "./presets.js"
import type { LopTheme, ThemeId } from "./types.js"

const ThemeContext = createContext<LopTheme>(themes[defaultThemeId])

export interface ThemeProviderProps {
    /** 显式主题；未传则用 env LOP_THEME */
    themeId?: ThemeId | string
    children: React.ReactNode
}

export function ThemeProvider({ themeId, children }: ThemeProviderProps) {
    const id = resolveThemeId(
        themeId ?? process.env["LOP_THEME"] ?? defaultThemeId,
    )
    const value = useMemo(() => themes[id], [id])
    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    )
}

export function useTheme(): LopTheme {
    return useContext(ThemeContext)
}

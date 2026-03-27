import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import React from "react"
import { useTheme } from "../themes/ThemeContext.js"

interface HeaderProps {
    model: string
    provider: string
    sessionId?: string | null
}

export const Header: React.FC<HeaderProps> = ({ model, provider, sessionId }) => {
    const { colors } = useTheme()
    const g = colors.ui.gradient
    const shortId = sessionId ? sessionId.slice(0, 8) : null
    return (
        <Box marginBottom={0} marginTop={1}>
            {g && g.length >= 2 ? (
                <Gradient colors={g}>
                    <Text bold>lop_minimal</Text>
                </Gradient>
            ) : (
                <Gradient name="fruit">
                    <Text bold>lop_minimal</Text>
                </Gradient>
            )}
            <Text dimColor> v0.1.0{shortId ? ` | ${shortId}` : ''} | </Text>
            <Text dimColor>{provider}/{model}</Text>
        </Box>
    )
}

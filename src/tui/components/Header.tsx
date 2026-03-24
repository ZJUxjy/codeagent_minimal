import { Box, Text } from "ink"
import Gradient from "ink-gradient"
import React from "react"
import { useTheme } from "../themes/ThemeContext.js"

interface HeaderProps {
    model: string
    provider: string
}

export const Header: React.FC<HeaderProps> = ({ model, provider }) => {
    const { colors } = useTheme()
    const g = colors.ui.gradient
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
            <Text dimColor> v0.1.0 | </Text>
            <Text dimColor>{provider}/{model}</Text>
        </Box>
    )
}
import React from "react"
import { Text } from "ink"
import Spinner from "ink-spinner"
import { useTheme } from "../themes/ThemeContext.js"

interface LoadingIndicatorProps {
    text?: string
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
    text = "Thinking...",
}) => {
    const { colors } = useTheme()
    return (
        <Text color={colors.text.secondary}>
            <Spinner type="dots12" /> {text}
        </Text>
    )
}

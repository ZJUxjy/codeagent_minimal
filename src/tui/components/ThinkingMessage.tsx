import React, { useState, useEffect, useMemo, useRef } from "react"
import { Box, Text } from "ink"
import type { SemanticColors } from "../themes/types.js"
import { truncate } from "../../utils/truncate.js"

interface ThinkingMessageProps {
    content: string
    colors: SemanticColors
    isStreaming?: boolean
}

export const ThinkingMessage: React.FC<ThinkingMessageProps> = ({
    content,
    colors,
    isStreaming = false,
}) => {
    const [isCollapsed, setIsCollapsed] = useState(true)
    const hasTimerStartedRef = useRef(false)
    const contentRef = useRef(content)

    contentRef.current = content

    const lines = useMemo(() => content.split("\n"), [content])

    useEffect(() => {
        if (isStreaming) {
            setIsCollapsed(false)
            hasTimerStartedRef.current = false
        }
    }, [isStreaming])

    useEffect(() => {
        if (!isStreaming && content.length > 0 && !hasTimerStartedRef.current) {
            hasTimerStartedRef.current = true
            const timer = setTimeout(() => {
                if (contentRef.current.length > 0) {
                    setIsCollapsed(true)
                }
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [isStreaming, content.length])

    const prefix = isStreaming ? "✦ " : "✓ "
    const statusText = isStreaming ? "Thinking..." : "Thought"

    if (isCollapsed) {
        const preview = truncate(content, 50)
        return (
            <Text dimColor color={colors.text.secondary}>
                {prefix}[{statusText}] {preview}
            </Text>
        )
    }

    return (
        <Box
            flexDirection="column"
            borderLeft
            borderStyle="single"
            borderColor={colors.border.default}
            paddingLeft={1}
            marginBottom={1}
        >
            <Text dimColor color={colors.text.secondary}>
                {prefix}{statusText}:
            </Text>
            <Box flexDirection="column" marginLeft={1}>
                {lines.map((line, i) => (
                    <Text key={i} dimColor color={colors.text.secondary}>
                        {line}
                    </Text>
                ))}
            </Box>
        </Box>
    )
}

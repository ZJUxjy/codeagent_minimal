import React, { useState, useEffect } from "react"
import { Box, Text } from "ink"
import type { SemanticColors } from "../themes/types.js"

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

    // 流式输出时自动展开
    useEffect(() => {
        if (isStreaming) {
            setIsCollapsed(false)
        }
    }, [isStreaming])

    // 流式输出完成后自动折叠
    useEffect(() => {
        if (!isStreaming && content.length > 0) {
            // 延迟折叠，让用户有时间看到内容
            const timer = setTimeout(() => {
                setIsCollapsed(true)
            }, 500)
            return () => clearTimeout(timer)
        }
    }, [isStreaming, content.length])

    const prefix = isStreaming ? "✦ " : "✓ "
    const statusText = isStreaming ? "Thinking..." : "Thought"

    if (isCollapsed) {
        // 折叠状态：只显示摘要
        const preview = content.length > 50 ? content.slice(0, 50) + "..." : content
        return (
            <Box flexDirection="row">
                <Text dimColor color={colors.text.secondary}>
                    {prefix}[{statusText}] {preview}
                </Text>
            </Box>
        )
    }

    // 展开状态：显示完整内容
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
                {content.split("\n").map((line, i) => (
                    <Text key={i} dimColor color={colors.text.secondary}>
                        {line}
                    </Text>
                ))}
            </Box>
        </Box>
    )
}

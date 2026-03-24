import React from "react"
import { Box, Text } from "ink"
import type { Message } from "../types.js"
import type { SemanticColors } from "../themes/types.js"
import { useTheme } from "../themes/ThemeContext.js"
import { AssistantProse } from "./markdown/AssistantProse.js"
import { CodeBlock } from "./markdown/CodeBlock.js"
import { splitFencedCodeBlocks } from "./markdown/parseFencedCode.js"
import { splitProseIntoBlocks } from "./markdown/splitProseBlocks.js"
import { ThinkingMessage } from "./ThinkingMessage.js"
import { truncate } from "../../utils/truncate.js"

interface MessageItemProps {
    message: Message
    /** 在 `<Static>` 内渲染时必须传入（Context 可能无法下发） */
    colors?: SemanticColors
}

export const MessageItem: React.FC<MessageItemProps> = ({
    message,
    colors: colorsProp,
}) => {
    const { colors: ctxColors } = useTheme()
    const colors = colorsProp ?? ctxColors

    if (message.role === "user") {
        return (
            <Box marginTop={0}>
                <Text bold color={colors.status.success}>
                    {"> "}
                </Text>
                <Text color={colors.text.primary}>{message.content}</Text>
            </Box>
        )
    } else if (message.role === "assistant") {
        const segments = splitFencedCodeBlocks(message.content)
        if (segments.length === 1 && segments[0].type === "prose") {
            const prose = segments[0]
            const blocks = splitProseIntoBlocks(prose.text)
            return (
                <Box marginTop={0}>
                    <AssistantProse blocks={blocks} colors={colors} />
                </Box>
            )
        }

        return (
            <Box marginTop={0} flexDirection="column">
                {segments.map((seg, i) =>
                    seg.type === "prose" ? (
                        <Box key={i} marginBottom={0}>
                            <AssistantProse
                                blocks={splitProseIntoBlocks(seg.text)}
                                colors={colors}
                            />
                        </Box>
                    ) : (
                        <CodeBlock
                            key={i}
                            lang={seg.lang}
                            code={seg.code}
                            colors={colors}
                        />
                    ),
                )}
            </Box>
        )
    } else if (message.role === "tool") {
        const { toolCall } = message
        const icon =
            toolCall.status === "success"
                ? "✅"
                : toolCall.status === "error"
                  ? "❌"
                  : "🔧"
        return (
            <Box marginTop={0} flexDirection="column">
                <Text dimColor>
                    {icon} {toolCall.name}({JSON.stringify(toolCall.args)})
                </Text>
                {toolCall.result ? (
                    <Text dimColor>
                        {truncate(toolCall.result, 200)}
                    </Text>
                ) : null}
            </Box>
        )
    } else if (message.role === "thinking") {
        return (
            <Box marginTop={0}>
                <ThinkingMessage
                    content={message.content}
                    colors={colors}
                    isStreaming={message.isStreaming}
                />
            </Box>
        )
    }
    return null
}

import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import type { Message } from "../types.js";
import { useTheme } from "../themes/ThemeContext.js";

interface MessageListProps {
    messages: Message[];
    streamingContent: string;
    thinkingContent?: string;
    isThinkingStreaming?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    streamingContent,
    thinkingContent,
    isThinkingStreaming,
}) => {
    const { colors } = useTheme();
    return (
        <Box flexDirection="column" marginBottom={0}>
            <Static items={messages}>
                {(message) => (
                    <MessageItem
                        key={message.id}
                        message={message}
                        colors={colors}
                    />
                )}
            </Static>
            {/* 思考内容（流式或完成） */}
            {thinkingContent ? (
                <Box marginTop={1}>
                    <ThinkingMessage
                        content={thinkingContent}
                        colors={colors}
                        isStreaming={isThinkingStreaming}
                    />
                </Box>
            ) : null}
            {/* 助手回复流式内容 */}
            {streamingContent ? (
                <Box marginTop={1}>
                    <Text color={colors.text.secondary}>{streamingContent}</Text>
                </Box>
            ) : null}
        </Box>
    );
};

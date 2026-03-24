import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import type { Message, StreamingState } from "../types.js";
import { useTheme } from "../themes/ThemeContext.js";

interface MessageListProps {
    messages: Message[];
    streaming: StreamingState;
}

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    streaming,
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
            {streaming.thinkingContent ? (
                <Box marginTop={1}>
                    <ThinkingMessage
                        content={streaming.thinkingContent}
                        colors={colors}
                        isStreaming={streaming.isThinkingStreaming}
                    />
                </Box>
            ) : null}
            {streaming.content ? (
                <Box marginTop={1}>
                    <Text color={colors.text.secondary}>{streaming.content}</Text>
                </Box>
            ) : null}
        </Box>
    );
};

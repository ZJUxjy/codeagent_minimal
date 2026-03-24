import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import type { Message } from "../types.js";
import { useTheme } from "../themes/ThemeContext.js";

interface MessageListProps {
    messages: Message[];
    streamingContent: string;
}

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    streamingContent,
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
            {streamingContent ? (
                <Box marginTop={1}>
                    <Text color={colors.text.secondary}>{streamingContent}</Text>
                </Box>
            ) : null}
        </Box>
    );
};

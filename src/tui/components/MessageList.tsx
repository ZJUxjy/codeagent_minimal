import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import type { Message } from "../types.js";

interface MessageListProps {
    messages: Message[];
    streamingContent: string;
}

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    streamingContent,
}) => {
    return (
        <Box flexDirection="column" marginBottom={1}>
            {/* 静态历史消息 */}
            <Static items={messages}>
                {(message) => (
                    <MessageItem key={message.id} message={message} />
                )}
            </Static>
            {/* 流式输出 */}
            {streamingContent ? (
                <Box marginTop={1}>
                    <Text color="cyan">{streamingContent}</Text>
                </Box>
            ) : null}
        </Box>
    );
};

import React from "react";
import { Box, Text } from "ink";
import type { Message } from "../types.js";

interface MessageItemProps {
    message: Message;
}

export const MessageItem: React.FC<MessageItemProps> = ({ message }) => {
    if (message.role === "user") {
        return (
            <Box marginTop={1}>
                <Text bold color="green">
                    {"> "}
                </Text>
                <Text>{message.content}</Text>
            </Box>
        );
    } else if (message.role === "assistant") {
        return (
            <Box marginTop={1}>
                <Text color="cyan">{message.content}</Text>
            </Box>
        );
    } else if (message.role === "tool") {
        const { toolCall } = message;
        const icon =
            toolCall.status === "success"
                ? "✅"
                : toolCall.status === "error"
                  ? "❌"
                  : "🔧";
        return (
            <Box marginTop={1} flexDirection="column">
                <Text dimColor>
                    {icon} {toolCall.name}({JSON.stringify(toolCall.args)})
                </Text>
                {toolCall.result ? (
                    <Text dimColor>
                        {toolCall.result.length > 200
                            ? toolCall.result.slice(0, 200) + "..."
                            : toolCall.result}
                    </Text>
                ) : null}
            </Box>
        );
    }
    return null;
};

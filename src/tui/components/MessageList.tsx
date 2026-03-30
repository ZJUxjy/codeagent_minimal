import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import type { Message, StreamingState } from "../types.js";
import type { SemanticColors } from "../themes/types.js";
import { useTheme } from "../themes/ThemeContext.js";

interface MessageListProps {
    messages: Message[];
    streaming: StreamingState;
    isLoading: boolean;
}

/** 用边框包裹正在进行的对话回合 */
const TurnBox: React.FC<{ colors: SemanticColors; children: React.ReactNode }> = ({
    colors,
    children,
}) => (
    <Box
        flexDirection="column"
        borderStyle="single"
        borderLeft={true}
        borderRight={false}
        borderTop={true}
        borderBottom={true}
        borderColor={colors.border.default}
        marginTop={1}
    >
        {children}
    </Box>
);

export const MessageList: React.FC<MessageListProps> = ({
    messages,
    streaming,
    isLoading,
}) => {
    const { colors } = useTheme();

    // Find the start of the active turn: the last user message while loading.
    // Everything before it is frozen in Static; from it onwards renders live.
    const lastUserIdx = React.useMemo(() => {
        if (!isLoading) return -1
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'user') return i
        }
        return -1
    }, [messages, isLoading])

    const hasActiveTurn = lastUserIdx >= 0
    const completedMessages = React.useMemo(
        () => hasActiveTurn ? messages.slice(0, lastUserIdx) : messages,
        [messages, hasActiveTurn, lastUserIdx],
    )
    const activeTurnMessages = hasActiveTurn ? messages.slice(lastUserIdx) : []

    return (
        <Box flexDirection="column" marginBottom={0}>
            <Static items={completedMessages}>
                {(msg) => (
                    <MessageItem key={msg.id} message={msg} colors={colors} />
                )}
            </Static>

            {/* 正在进行的回合不放入 Static（需要实时更新） */}
            {hasActiveTurn ? (
                <TurnBox colors={colors}>
                    {activeTurnMessages.map((msg) => (
                        <MessageItem key={msg.id} message={msg} colors={colors} />
                    ))}
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
                </TurnBox>
            ) : null}
        </Box>
    );
};

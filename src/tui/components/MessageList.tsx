import React from "react";
import { Box, Text, Static } from "ink";
import { MessageItem } from "./MessageItem.js";
import { ThinkingMessage } from "./ThinkingMessage.js";
import type { Message, MessageTurn, StreamingState } from "../types.js";
import type { SemanticColors } from "../themes/types.js";
import { useTheme } from "../themes/ThemeContext.js";

interface MessageListProps {
    messages: Message[];
    streaming: StreamingState;
    isLoading: boolean;
}

/** 按回合分组消息：每个 user 消息到下一个 user 消息之前 */
function groupIntoTurns(messages: Message[]): MessageTurn[] {
    const turns: MessageTurn[] = [];
    let current: Message[] = [];

    for (const msg of messages) {
        if (msg.role === "user" && current.length > 0) {
            turns.push({ id: current[0].id, messages: current });
            current = [];
        }
        current.push(msg);
    }

    if (current.length > 0) {
        turns.push({ id: current[0].id, messages: current });
    }

    return turns;
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

    const turns = React.useMemo(() => groupIntoTurns(messages), [messages]);
    const hasActiveTurn = isLoading && turns.length > 0
        && turns[turns.length - 1].messages.some(m => m.role === 'user')
    const completedTurns = React.useMemo(
        () => (hasActiveTurn ? turns.slice(0, -1) : turns),
        [turns, isLoading],
    );
    const activeTurn = hasActiveTurn ? turns[turns.length - 1] : null;

    // Flatten completed turns into individual messages so Static keys by message
    // id rather than turn id. This prevents the frozen-turn bug where new messages
    // added to an existing turn are silently dropped by Static's once-only render.
    const completedMessages = React.useMemo(
        () => completedTurns.flatMap(t => t.messages),
        [completedTurns],
    );

    return (
        <Box flexDirection="column" marginBottom={0}>
            <Static items={completedMessages}>
                {(msg) => (
                    <MessageItem key={msg.id} message={msg} colors={colors} />
                )}
            </Static>

            {/* 正在进行的回合不放入 Static（需要实时更新） */}
            {activeTurn ? (
                <TurnBox colors={colors}>
                    {activeTurn.messages.map((msg) => (
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

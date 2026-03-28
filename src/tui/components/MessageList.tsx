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

/** 将扁平消息数组按"回合"分组：每个 user 消息到下一个 user 消息之前 */
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

/** 用左边框包裹一个对话回合 */
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

    const turns = groupIntoTurns(messages);

    // 正在进行的回合不放入 Static（需要实时更新），已完成的放入
    const hasActiveTurn = isLoading && turns.length > 0;
    const completedTurns = hasActiveTurn ? turns.slice(0, -1) : turns;
    const activeTurn = hasActiveTurn ? turns[turns.length - 1] : null;

    return (
        <Box flexDirection="column" marginBottom={0}>
            <Static items={completedTurns}>
                {(turn) => (
                    <TurnBox key={turn.id} colors={colors}>
                        {turn.messages.map((msg) => (
                            <MessageItem key={msg.id} message={msg} colors={colors} />
                        ))}
                    </TurnBox>
                )}
            </Static>

            {/* 当前进行中的回合 — 实时渲染 */}
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

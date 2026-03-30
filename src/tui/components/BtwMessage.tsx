import React, { useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../themes/ThemeContext.js'
import Spinner from 'ink-spinner'

interface BtwMessageProps {
    question: string
    answer: string
    isStreaming: boolean
    onDismiss: () => void
    onCancel: () => void
}

export const BtwMessage: React.FC<BtwMessageProps> = ({ question, answer, isStreaming, onDismiss, onCancel }) => {
    const { colors } = useTheme()

    useInput((input, key) => {
        if (key.escape) {
            if (isStreaming) {
                onCancel()
            } else {
                onDismiss()
            }
            return
        }
        if (!isStreaming && (input === ' ' || key.return)) {
            onDismiss()
        }
    })

    const displayAnswer = answer || (isStreaming ? 'Answering...' : '')
    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={isStreaming ? colors.status.success : colors.border.focused}
            paddingX={1}
            marginTop={0}
        >
            <Box>
                <Text bold color={colors.status.success}>/btw </Text>
                <Text dimColor>{question}</Text>
            </Box>
            <Box marginTop={0}>
                {isStreaming && <><Spinner type="dots" /><Text> </Text></>}<Text color={colors.status.success}>{displayAnswer}</Text>
            </Box>
            <Box>
                <Text dimColor>
                    {isStreaming
                        ? 'Press Escape to cancel'
                        : 'Press Space, Enter, or Escape to dismiss'}
                </Text>
            </Box>
        </Box>
    )
}

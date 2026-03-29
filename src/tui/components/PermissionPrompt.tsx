import React from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../themes/ThemeContext.js'
import type { PermissionOutcome } from '../../protocol/types.js'

interface PermissionPromptProps {
    summary: string
    onDecide: (outcome: PermissionOutcome) => void
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
    summary,
    onDecide,
}) => {
    const { colors } = useTheme()

    useInput((input, key) => {
        const ch = input.toLowerCase()
        if (ch === 'a' || key.return) {
            onDecide('allow')
        } else if (ch === 'w') {
            onDecide('always')
        } else if (ch === 'd' || key.escape) {
            onDecide('deny')
        }
    })

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={colors.status.warning ?? 'yellow'}
            paddingX={1}
            paddingY={0}
        >
            <Box marginBottom={1}>
                <Text bold color={colors.status.warning ?? 'yellow'}>⚠ Permission Required</Text>
            </Box>

            <Box marginBottom={1}>
                <Text bold>{summary}</Text>
            </Box>

            <Box gap={3}>
                <Text>
                    <Text bold color="green">[A]</Text>
                    <Text> Allow once</Text>
                </Text>
                <Text>
                    <Text bold color="cyan">[W]</Text>
                    <Text> Always allow</Text>
                </Text>
                <Text>
                    <Text bold color="red">[D]</Text>
                    <Text> Deny</Text>
                </Text>
            </Box>
        </Box>
    )
}

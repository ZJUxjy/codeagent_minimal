import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../themes/ThemeContext.js'
import type { PermissionOutcome } from '../../protocol/types.js'

interface PermissionPromptProps {
    toolName: string
    summary: string
    onDecide: (outcome: PermissionOutcome) => void
}

export const PermissionPrompt: React.FC<PermissionPromptProps> = ({
    toolName,
    summary,
    onDecide,
}) => {
    const { colors } = useTheme()
    const [decided, setDecided] = useState(false)

    useInput((input, key) => {
        if (decided) return

        const ch = input.toLowerCase()
        if (ch === 'a' || key.return) {
            setDecided(true)
            onDecide('allow')
        } else if (ch === 'w') {
            setDecided(true)
            onDecide('always')
        } else if (ch === 'd' || key.escape) {
            setDecided(true)
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
                <Text color={colors.text.secondary}>{toolName}: </Text>
                <Text bold>{summary}</Text>
            </Box>

            <Box gap={3}>
                {!decided ? (
                    <>
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
                    </>
                ) : (
                    <Text dimColor>Processing...</Text>
                )}
            </Box>
        </Box>
    )
}

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { SlashCommand } from '../../commands/types.js'

interface InputBoxProps {
    onSubmit: (value: string) => void
    onClear: () => void
    disabled?: boolean
    commands?: SlashCommand[]
}

export const InputBox = ({ onSubmit, onClear, disabled, commands = [] }: InputBoxProps) => {
    const [value, setValue] = useState('')
    const [history, setHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    // 构建命令提示
    const commandHint = useMemo(() => {
        if (!value.startsWith('/') || value.includes(' ')) return null

        const partial = value.slice(1).toLowerCase()
        if (!partial) return null

        // 查找匹配的命令
        const match = commands.find(cmd =>
            cmd.name.startsWith(partial) ||
            cmd.altNames?.some(alt => alt.startsWith(partial))
        )

        if (match && match.name !== partial) {
            return match.name
        }

        return null
    }, [value, commands])

    useInput((input, key) => {
        if (disabled) return

        // Tab 补全命令
        if (key.tab && commandHint) {
            setValue(`/${commandHint} `)
            return
        }

        // 上下箭头浏览历史
        if (key.upArrow) {
            if (historyIndex < history.length - 1) {
                const newIndex = historyIndex + 1
                setHistoryIndex(newIndex)
                setValue(history[history.length - 1 - newIndex] ?? '')
            }
        } else if (key.downArrow) {
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1
                setHistoryIndex(newIndex)
                setValue(history[history.length - 1 - newIndex] ?? '')
            } else if (historyIndex === 0) {
                setHistoryIndex(-1)
                setValue('')
            }
        }
    })

    const handleSubmit = (submitValue: string) => {
        if (!submitValue.trim()) return

        // Tab 补全提示时按回车
        if (commandHint && submitValue === value) {
            setValue(`/${commandHint} `)
            return
        }

        setHistory(prev => [...prev, submitValue])
        setHistoryIndex(-1)

        onSubmit(submitValue)
        setValue('')
    }

    return (
        <Box flexDirection="column" marginTop={1}>
            {/* 命令补全提示 */}
            {commandHint && (
                <Box marginLeft={2}>
                    <Text dimColor>
                        → /{commandHint}
                    </Text>
                </Box>
            )}

            {/* 输入框 */}
            <Box borderStyle="round" borderColor="cyan">
                <Text bold color={disabled ? 'gray' : 'blue'}>
                    {disabled ? '...' : '>'}
                </Text>
                <TextInput
                    value={value}
                    onChange={setValue}
                    onSubmit={handleSubmit}
                    placeholder={disabled ? 'Waiting for response...' : 'Type a message or /help...'}
                    showCursor={!disabled}
                />
            </Box>
        </Box>
    )
}

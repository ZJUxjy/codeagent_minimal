import React, { useState, useMemo, useEffect } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import TextInput from 'ink-text-input'
import { CommandCompletion } from './CommandCompletion.js'
import type { SlashCommand } from '../../commands/types.js'
import { useTheme } from '../themes/ThemeContext.js'
import { truncate } from '../../utils/truncate.js'

interface InputBoxProps {
    onSubmit: (value: string) => void
    onClear: () => void
    disabled?: boolean
    commands?: SlashCommand[]
}

export const InputBox = ({ onSubmit, onClear, disabled, commands = [] }: InputBoxProps) => {
    const { colors } = useTheme()
    const [value, setValue] = useState('')
    const [history, setHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)
    const [inputKey, setInputKey] = useState(0) // 用于强制重新挂载 TextInput
    const [selectedIndex, setSelectedIndex] = useState(0)
    const { stdout } = useStdout()
    const terminalWidth = stdout.columns

    // 焦点管理：0 = 主输入框, 1 = 测试输入框
    const [focusIndex, setFocusIndex] = useState(0)

    const [testValue, setTestValue] = useState('')

    const truncateForBlur = (text: string, isFocused: boolean, maxLen: number = 15) => {
        return isFocused ? text : truncate(text, maxLen - 3)
    }
    const matchedCommands = useMemo(() => {
        if (!value.startsWith('/')) return []
        const partial = value.slice(1).toLowerCase()
        if (!partial) return commands

        return commands.filter(cmd =>
            cmd.name.startsWith(partial)
            // ||cmd.altNames?.some(alt => alt.startsWith(partial))
        )
    }, [value, commands])

    useEffect(() => {
        setSelectedIndex(0)
    }, [value, matchedCommands.length])

    const selectedCommand = useMemo(() => {
        if (matchedCommands.length === 0) return null
        return matchedCommands[selectedIndex] ?? null
    }, [matchedCommands, selectedIndex])

    const showCompletion = useMemo(() => {
        return value.startsWith('/') &&
            !value.includes(' ') &&
            matchedCommands.length > 0
    }, [value, matchedCommands.length])

    useInput((_input, key) => {
        if (disabled) return
        if(key.ctrl && key.backspace) {
            console.log('ctrl+backspace')
            setValue('')
            setInputKey(k => k + 1)
            return
        }
        if (key.tab) {
            if (focusIndex === 0 && selectedCommand) {
                const newValue = `/${selectedCommand.name} `
                setValue(newValue)
                setInputKey(k => k + 1)
                return
            }
            setFocusIndex(i => (i + 1) % 2)
            return
        }

        if (showCompletion && matchedCommands.length > 0) {
            if (key.upArrow) {
                setSelectedIndex(i => (i - 1 + matchedCommands.length) % matchedCommands.length)
                return
            }
            if (key.downArrow) {
                setSelectedIndex(i => (i + 1) % matchedCommands.length)
                return
            }
            if (key.escape) {
                setValue(value + ' ')
                setInputKey(k => k + 1)
                return
            }
        }

        if (!showCompletion) {
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
        }
    })

    const handleSubmit = (submitValue: string) => {
        if (!submitValue.trim()) return

        if (showCompletion && selectedCommand) {
            const newValue = `/${selectedCommand.name} `
            setValue(newValue)
            setInputKey(k => k + 1)
            return
        }

        setHistory(prev => [...prev, submitValue])
        setHistoryIndex(-1)

        onSubmit(submitValue)
        setValue('')
    }

    return (
        <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row" gap={0}>
                <Box borderStyle="round" borderColor={focusIndex === 0 ? colors.border.focused : colors.border.default} flexGrow={focusIndex === 0 ? 8 : 2} flexBasis={0} 
                height={focusIndex===0?'auto':3} width={'auto'}>
                    <Text bold color={disabled ? colors.text.secondary : (focusIndex === 0 ? colors.border.focused : colors.text.secondary)}>
                        {disabled ? '...' : '>'}
                    </Text>
                    <TextInput
                        key={inputKey}
                        value={truncateForBlur(value,focusIndex===0,Math.max( Math.floor(terminalWidth * 0.2)-8,0))}
                        onChange={setValue}
                        onSubmit={handleSubmit}
                        placeholder={disabled ? 'Waiting...' : 'Message or /help...'}
                        showCursor={!disabled && focusIndex === 0}
                        focus={focusIndex === 0 && !disabled}
                    />
                </Box>

                <Box borderStyle="round" borderColor={focusIndex === 1 ? colors.status.success : colors.border.default} flexGrow={focusIndex === 1 ? 8 : 2} flexBasis={0}
                height={focusIndex===1?'auto':3} width={'auto'}
                >
                    <Text bold color={focusIndex === 1 ? colors.status.success : colors.text.secondary}>
                        {'[TEST] '}
                    </Text>
                    <TextInput
                        value={truncateForBlur(testValue,focusIndex===1,Math.max( Math.floor(terminalWidth * 0.2)-8,0))}
                        onChange={setTestValue}
                        onSubmit={(v) => {
                            if (v.trim()) {
                                setTestValue('')
                            }
                        }}
                        placeholder="Test input..."
                        showCursor={focusIndex === 1}
                        focus={focusIndex === 1}
                    />
                </Box>
            </Box>

            {showCompletion && focusIndex === 0 && (
                <CommandCompletion
                    commands={matchedCommands}
                    selectedIndex={selectedIndex}
                    inputPrefix={value}
                />
            )}
        </Box>
    )
}

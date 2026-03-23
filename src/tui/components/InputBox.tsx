import React, { useState, useMemo, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import { CommandCompletion } from './CommandCompletion.js'
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
    const [inputKey, setInputKey] = useState(0) // 用于强制重新挂载 TextInput
    const [selectedIndex, setSelectedIndex] = useState(0)

    // 匹配的命令列表
    const matchedCommands = useMemo(() => {
        if (!value.startsWith('/')) return []
        const partial = value.slice(1).toLowerCase()
        if (!partial) return commands

        return commands.filter(cmd =>
            cmd.name.startsWith(partial) 
            // ||cmd.altNames?.some(alt => alt.startsWith(partial))
        )
    }, [value, commands])

    // 当输入变化时重置选中索引
    useEffect(() => {
        setSelectedIndex(0)
    }, [value, matchedCommands.length])

    // 当前选中的命令（用于 Tab 补全）
    const selectedCommand = useMemo(() => {
        if (matchedCommands.length === 0) return null
        return matchedCommands[selectedIndex] ?? null
    }, [matchedCommands, selectedIndex])

    // 是否显示补全列表
    const showCompletion = useMemo(() => {
        return value.startsWith('/') &&
               !value.includes(' ') &&
               matchedCommands.length > 0
    }, [value, matchedCommands.length])

    useInput((_input, key) => {
        if (disabled) return

        // Tab 补全命令
        if (key.tab && selectedCommand) {
            const newValue = `/${selectedCommand.name} `
            setValue(newValue)
            setInputKey(k => k + 1)
            return
        }

        // 补全列表导航
        if (showCompletion && matchedCommands.length > 0) {
            if (key.upArrow) {
                setSelectedIndex(i => (i - 1 + matchedCommands.length) % matchedCommands.length)
                return
            }
            if (key.downArrow) {
                setSelectedIndex(i => (i + 1) % matchedCommands.length)
                return
            }
            // Esc 键关闭补全（通过清除输入或添加空格）
            if (key.escape) {
                setValue(value + ' ')
                setInputKey(k => k + 1)
                return
            }
        }

        // 上下箭头浏览历史（仅在不显示补全列表时）
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

        // 有补全列表时回车补全而不是提交
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
        <Box flexDirection="column" marginTop={1}>
            {/* 输入框 */}
            <Box borderStyle="round" borderColor="cyan">
                <Text bold color={disabled ? 'gray' : 'blue'}>
                    {disabled ? '...' : '>'}
                </Text>
                <TextInput
                    key={inputKey}
                    value={value}
                    onChange={setValue}
                    onSubmit={handleSubmit}
                    placeholder={disabled ? 'Waiting for response...' : 'Type a message or /help...'}
                    showCursor={!disabled}
                />
            </Box>

            {/* 命令补全列表 */}
            {showCompletion && (
                <CommandCompletion
                    commands={matchedCommands}
                    selectedIndex={selectedIndex}
                    inputPrefix={value}
                />
            )}
        </Box>
    )
}

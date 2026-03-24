import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { CommandCompletion } from './CommandCompletion.js'
import { MultilineTextInput } from './MultilineTextInput.js'
import { useInputBuffer } from '../hooks/useInputBuffer.js'
import { useInputHistory } from '../hooks/useInputHistory.js'
import { usePasteHandler, useKeyHandler } from '../contexts/KeypressContext.js'
import type { SlashCommand } from '../../commands/types.js'
import { useTheme } from '../themes/ThemeContext.js'

interface InputBoxProps {
    onSubmit: (value: string) => void
    onClear: () => void
    onInterrupt?: () => void
    disabled?: boolean
    commands?: SlashCommand[]
}

export const InputBox = ({ onSubmit, onClear, onInterrupt, disabled, commands = [] }: InputBoxProps) => {
    const { colors } = useTheme()
    const buffer = useInputBuffer()
    const history = useInputHistory(buffer)
    const [focusIndex, setFocusIndex] = useState(0)
    const [selectedIndex, setSelectedIndex] = useState(0)

    const isMainFocused = focusIndex === 0 && !disabled
    const text = buffer.text
    const [pendingBackslash, setPendingBackslash] = useState(false)

    const matchedCommands = useMemo(() => {
        if (!text.startsWith('/')) return []
        const partial = text.slice(1).toLowerCase()
        if (text.includes('\n')) return []
        if (!partial) return commands
        return commands.filter(cmd => cmd.name.startsWith(partial))
    }, [text, commands])

    useEffect(() => {
        setSelectedIndex(0)
    }, [text, matchedCommands.length])

    const selectedCommand = matchedCommands[selectedIndex] ?? null
    const showCompletion = useMemo(() => {
        return text.startsWith('/') &&
            !text.includes(' ') &&
            !text.includes('\n') &&
            matchedCommands.length > 0
    }, [text, matchedCommands.length])

    usePasteHandler(
        useCallback((key) => {
            buffer.snapshot()
            buffer.insert(key.sequence)
        }, [buffer]),
        { isActive: isMainFocused },
    )

    useKeyHandler(
        useCallback((key) => {
            if (key.type === 'backspace') {
                buffer.backspace()
            } else if (key.type === 'forwardDelete') {
                buffer.delete()
            }
        }, [buffer]),
        { isActive: isMainFocused },
    )

    useInput((input, key) => {
        if (disabled) {
            if (key.escape) {
                onInterrupt?.()
            }
            return
        }

        if (key.tab) {
            if (focusIndex === 0 && showCompletion && selectedCommand) {
                buffer.setText(`/${selectedCommand.name} `)
                return
            }
            setFocusIndex(i => (i + 1) % 2)
            return
        }

        if (focusIndex !== 0) return

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
                buffer.insert(' ')
                return
            }
        }

        if (key.return) {
            // newline: Shift+Enter, Ctrl+Enter, or \ then Enter
            if (key.shift || key.ctrl || pendingBackslash) {
                if (pendingBackslash) {
                    buffer.backspace()
                    setPendingBackslash(false)
                }
                buffer.snapshot()
                buffer.newline()
                return
            }
            // submit
            if (!text.trim()) return
            if (showCompletion && selectedCommand) {
                buffer.setText(`/${selectedCommand.name} `)
                return
            }
            setPendingBackslash(false)
            buffer.snapshot()
            history.push(text)
            onSubmit(text)
            buffer.clear()
            return
        }

        if (key.ctrl) {
            switch (input) {
                case 'a':
                    buffer.move('home')
                    return
                case 'e':
                    buffer.move('end')
                    return
                case 'k':
                    buffer.snapshot()
                    buffer.killLineRight()
                    return
                case 'u':
                    buffer.snapshot()
                    buffer.killLineLeft()
                    return
                case 'w':
                    buffer.snapshot()
                    buffer.deleteWordLeft()
                    return
                case 'z':
                    buffer.undo()
                    return
                case 'y':
                    buffer.redo()
                    return
                case 'l':
                    onClear()
                    return
            }
        }

        if (key.meta) {
            if (key.leftArrow) {
                buffer.moveWord('left')
                return
            }
            if (key.rightArrow) {
                buffer.moveWord('right')
                return
            }
            if (input === 'b') {
                buffer.moveWord('left')
                return
            }
            if (input === 'f') {
                buffer.moveWord('right')
                return
            }
        }

        if (!showCompletion) {
            if (key.upArrow) {
                if (buffer.lines.length > 1 && buffer.cursor.row > 0) {
                    buffer.move('up')
                } else {
                    history.navigateUp()
                }
                return
            }
            if (key.downArrow) {
                const lastRow = buffer.lines.length - 1
                if (buffer.lines.length > 1 && buffer.cursor.row < lastRow) {
                    buffer.move('down')
                } else {
                    history.navigateDown()
                }
                return
            }
        }

        if (key.leftArrow) {
            buffer.move('left')
            return
        }
        if (key.rightArrow) {
            buffer.move('right')
            return
        }
        if (input && !key.ctrl && !key.meta) {
            setPendingBackslash(input === '\\')
            buffer.insert(input)
        }
    })

    return (
        <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row" gap={0}>

                <Box
                    borderStyle="round"
                    borderColor={focusIndex === 0 ? colors.border.focused : colors.border.default}
                    flexGrow={focusIndex === 0 ? 8 : 2}
                    flexBasis={0}
                    paddingLeft={0}
                >
                    <Text
                        bold
                        color={disabled
                            ? colors.text.secondary
                            : focusIndex === 0
                                ? colors.border.focused
                                : colors.text.secondary
                        }
                    >
                        {disabled ? '...' : '> '}
                    </Text>
                    <Box flexGrow={1}>
                        <MultilineTextInput
                            buffer={buffer}
                            placeholder={disabled ? 'Waiting...' : 'Message or /help...'}
                            showCursor={isMainFocused}
                            focus={isMainFocused}
                        />
                    </Box>
                </Box>

                <Box
                    borderStyle="round"
                    borderColor={focusIndex === 1 ? colors.status.success : colors.border.default}
                    flexGrow={focusIndex === 1 ? 8 : 2}
                    flexBasis={0}
                >
                    <Text bold color={focusIndex === 1 ? colors.status.success : colors.text.secondary}>
                        {'[+] '}
                    </Text>
                    <Text dimColor color={colors.text.secondary}>
                        {focusIndex === 1 ? 'coming soon' : ''}
                    </Text>
                </Box>
            </Box>

            {showCompletion && focusIndex === 0 && (
                <CommandCompletion
                    commands={matchedCommands}
                    selectedIndex={selectedIndex}
                    inputPrefix={text}
                />
            )}
        </Box>
    )
}

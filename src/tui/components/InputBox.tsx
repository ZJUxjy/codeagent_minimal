import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { CommandCompletion } from './CommandCompletion.js'
import { MultilineTextInput } from './MultilineTextInput.js'
import { useInputBuffer } from '../hooks/useInputBuffer.js'
import { useInputHistory } from '../hooks/useInputHistory.js'
import { usePasteHandler, useKeyHandler, useKeypressContext } from '../contexts/KeypressContext.js'
import type { SlashCommand } from '../../commands/types.js'
import { useTheme } from '../themes/ThemeContext.js'
import { escapeRegex } from '../../utils/regex.js'

const LARGE_PASTE_CHAR_THRESHOLD = 1000;
const LARGE_PASTE_LINE_THRESHOLD = 5;

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

    // Large paste placeholder state
    const [pendingPastes, setPendingPastes] = useState<Map<string, string>>(new Map())
    const activePlaceholderIds = useRef<Map<number, Set<number>>>(new Map())

    const nextLargePastePlaceholder = useCallback((charCount: number): string => {
        const activeIds = activePlaceholderIds.current.get(charCount) ?? new Set<number>()
        let id = 1
        while (activeIds.has(id)) { id++ }
        activeIds.add(id)
        activePlaceholderIds.current.set(charCount, activeIds)
        const base = `[Pasted Content ${charCount} chars]`
        return id === 1 ? base : `${base} #${id}`
    }, [])

    const freePlaceholderId = useCallback((placeholder: string) => {
        const match = placeholder.match(/^\[Pasted Content (\d+) chars\](?: #(\d+))?$/)
        if (!match) return
        const charCount = parseInt(match[1], 10)
        const id = match[2] ? parseInt(match[2], 10) : 1
        const activeIds = activePlaceholderIds.current.get(charCount)
        if (activeIds) {
            activeIds.delete(id)
            if (activeIds.size === 0) {
                activePlaceholderIds.current.delete(charCount)
            }
        }
    }, [])

    const placeholderRegex = useMemo(() => {
        if (pendingPastes.size === 0) return null
        const placeholders = Array.from(pendingPastes.keys()).sort((a, b) => b.length - a.length)
        return new RegExp(placeholders.map(escapeRegex).join('|'), 'g')
    }, [pendingPastes])

    const expandPlaceholders = useCallback((raw: string): string => {
        if (!placeholderRegex) return raw
        return raw.replace(placeholderRegex, match => pendingPastes.get(match) ?? match)
    }, [placeholderRegex, pendingPastes])

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

    const { isSuppressing } = useKeypressContext()

    usePasteHandler(
        useCallback((key) => {
            const pasted = key.sequence.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
            const charCount = [...pasted].length
            const lineCount = pasted.split('\n').length

            if (charCount > LARGE_PASTE_CHAR_THRESHOLD || lineCount > LARGE_PASTE_LINE_THRESHOLD) {
                const placeholder = nextLargePastePlaceholder(charCount)
                setPendingPastes(prev => {
                    const next = new Map(prev)
                    next.set(placeholder, pasted)
                    return next
                })
                buffer.snapshot()
                buffer.insert(placeholder)
            } else {
                buffer.snapshot()
                buffer.insert(pasted)
            }
        }, [buffer, nextLargePastePlaceholder]),
        { isActive: isMainFocused },
    )

    useKeyHandler(
        useCallback((key) => {
            if (key.type === 'backspace') {
                if (pendingPastes.size > 0) {
                    const { row, col } = buffer.cursor
                    let offset = 0
                    for (let i = 0; i < row; i++) {
                        offset += buffer.lines[i].length + 1
                    }
                    offset += col
                    const currentText = buffer.text
                    for (const placeholder of pendingPastes.keys()) {
                        const placeholderStart = offset - placeholder.length
                        if (placeholderStart >= 0 && currentText.slice(placeholderStart, offset) === placeholder) {
                            buffer.replaceRangeByOffset(placeholderStart, offset, '')
                            setPendingPastes(prev => {
                                const next = new Map(prev)
                                next.delete(placeholder)
                                return next
                            })
                            freePlaceholderId(placeholder)
                            return
                        }
                    }
                }
                buffer.backspace()
            } else if (key.type === 'forwardDelete') {
                buffer.delete()
            }
        }, [buffer, pendingPastes, freePlaceholderId]),
        { isActive: isMainFocused },
    )

    useInput((input, key) => {
        if (isSuppressing()) return
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
            const finalValue = expandPlaceholders(text)
            setPendingPastes(new Map())
            activePlaceholderIds.current.clear()
            onSubmit(finalValue)
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

import React, { useState, useRef, useEffect, JSX } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface InputBoxProps {
    onSubmit: (value: string) => void
    onClear: () => void
    disabled?: boolean
}

export const InputBox = ({ onSubmit, onClear, disabled }: InputBoxProps) => {
    const [value, setValue] = useState('')
    const [history, setHistory] = useState<string[]>([])
    const [historyIndex, setHistoryIndex] = useState(-1)

    useInput((input, key) => {
        if (disabled) return

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
    });

    const handleSubmit = (submitValue: string) => {
        if (!submitValue.trim()) return

        if (submitValue === '/clear') {
            onClear()
            setValue('')
            return
        }

        setHistory(prev => [...prev, submitValue])
        setHistoryIndex(-1)

        onSubmit(submitValue)
        setValue('')
    }

    return (
        <Box marginTop={1}>
            <Text bold color={'blue'}>{disabled ? '...' : '>'}</Text>
            <TextInput
                value={value}
                onChange={setValue}
                onSubmit={handleSubmit}
                placeholder={disabled ? 'Waiting for response...' : 'Type a message...'}
                showCursor={!disabled}
            />
        </Box>
    )
}
import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../themes/ThemeContext.js'
import type { Question } from '../../protocol/types.js'

interface AskQuestionDialogProps {
    questions: Question[]
    onSubmit: (answers: Record<string, string>) => void
    onCancel: () => void
}

export const AskQuestionDialog: React.FC<AskQuestionDialogProps> = ({
    questions,
    onSubmit,
    onCancel,
}) => {
    const { colors } = useTheme()
    const [questionIndex, setQuestionIndex] = useState(0)
    const [selectedIndex, setSelectedIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set())

    const question = questions[questionIndex]
    const isMulti = question.allowMultiple ?? false
    const optionCount = question.options.length

    const submitCurrentQuestion = useCallback((label: string) => {
        const newAnswers = { ...answers, [question.id]: label }
        setAnswers(newAnswers)

        if (questionIndex < questions.length - 1) {
            setQuestionIndex(i => i + 1)
            setSelectedIndex(0)
            setMultiSelected(new Set())
        } else {
            onSubmit(newAnswers)
        }
    }, [answers, question, questionIndex, questions.length, onSubmit])

    const submitMultiSelect = useCallback(() => {
        if (multiSelected.size === 0) return
        const label = Array.from(multiSelected).join(', ')
        submitCurrentQuestion(label)
    }, [multiSelected, submitCurrentQuestion])

    useInput((input, key) => {
        if (key.escape) {
            onCancel()
            return
        }

        if (key.upArrow) {
            setSelectedIndex(i => Math.max(0, i - 1))
            return
        }
        if (key.downArrow) {
            setSelectedIndex(i => Math.min(optionCount - 1, i + 1))
            return
        }

        const num = parseInt(input, 10)
        if (!isNaN(num) && num >= 1 && num <= optionCount) {
            setSelectedIndex(num - 1)
            return
        }

        if (key.return) {
            const option = question.options[selectedIndex]
            if (!option) return

            if (isMulti) {
                submitMultiSelect()
            } else {
                submitCurrentQuestion(option.label)
            }
            return
        }

        if (input === ' ' && isMulti) {
            const option = question.options[selectedIndex]
            if (!option) return
            setMultiSelected(prev => {
                const next = new Set(prev)
                if (next.has(option.label)) {
                    next.delete(option.label)
                } else {
                    next.add(option.label)
                }
                return next
            })
        }
    })

    return (
        <Box flexDirection="column" borderStyle="round" borderColor={colors.border.focused} paddingX={1}>
            {questions.length > 1 && (
                <Box marginBottom={1}>
                    <Text dimColor>
                        Question {questionIndex + 1}/{questions.length}
                    </Text>
                </Box>
            )}

            <Box marginBottom={1}>
                <Text bold color={colors.border.focused}>? </Text>
                <Text bold>{question.prompt}</Text>
            </Box>

            {question.options.map((opt, idx) => {
                const isSelected = selectedIndex === idx
                const isChecked = isMulti && multiSelected.has(opt.label)
                const highlight = isSelected || isChecked

                return (
                    <Box key={idx} flexDirection="column">
                        <Box>
                            <Text
                                color={highlight ? colors.border.focused : undefined}
                                bold={highlight}
                            >
                                {isSelected ? '> ' : '  '}
                                {isMulti ? (isChecked ? '[✔] ' : '[ ] ') : ''}
                                {idx + 1}. {opt.label}
                            </Text>
                        </Box>
                        {opt.description && (
                            <Box marginLeft={isMulti ? 8 : 4}>
                                <Text dimColor>{opt.description}</Text>
                            </Box>
                        )}
                    </Box>
                )
            })}

            <Box marginTop={1}>
                <Text dimColor>
                    {isMulti
                        ? 'Up/Down: Navigate | Space: Toggle | Enter: Confirm | Esc: Cancel'
                        : 'Up/Down: Navigate | Enter: Select | Esc: Cancel'
                    }
                </Text>
            </Box>
        </Box>
    )
}

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Box, Text, useApp, useStdout } from 'ink'
import { ThemeProvider, useTheme } from './themes/ThemeContext.js'
import { Header } from './components/Header.js'
import { MessageList } from './components/MessageList.js'
import { InputBox } from './components/InputBox.js'
import { LoadingIndicator } from './components/LoadingIndicator.js'
import { AskQuestionDialog } from './components/AskQuestionDialog.js'
import { PermissionPrompt } from './components/PermissionPrompt.js'
import { BtwMessage } from './components/BtwMessage.js'
import { useClient } from './hooks/useClient.js'
import { useSlashCommandProcessor } from './hooks/useSlashCommandProcessor.js'
import type { Message, StreamingState, ToolStats, PendingToolCall } from './types.js'
import type { ClientOptions } from '../client/index.js'
import type { LopConfig, Question, PermissionOutcome } from '../protocol/types.js'
import type { ThemeId } from './themes/types.js'
import {
    listBuiltinThemes,
    resolveThemeId,
    tryParseThemeId,
} from './themes/presets.js'
import { getGlobalLogger } from '../utils/logger.js'
import { getErrorMessage } from '../utils/error.js'

interface AppProps {
    clientOptions: ClientOptions
    clearScreen?: () => void
}

function InitErrorText({ message }: { message: string }) {
    const { colors } = useTheme()
    return (
        <Text color={colors.status.error}>
            Failed to initialize: {message}
        </Text>
    )
}

export const App: React.FC<AppProps> = ({ clientOptions, clearScreen }) => {
    const { exit } = useApp()

    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    // Separate from isLoading so slash commands don't affect hasActiveTurn in MessageList
    const [isCommandRunning, setIsCommandRunning] = useState(false)

    // 工具统计
    const [toolStats, setToolStats] = useState<ToolStats>(new Map())
    const pendingCallsRef = useRef<Map<string, PendingToolCall>>(new Map())

    const [pendingQuestions, setPendingQuestions] = useState<Array<{
        requestId: string
        questions: Question[]
    }>>([])

    const [pendingPermissions, setPendingPermissions] = useState<Array<{
        requestId: string
        toolName: string
        summary: string
    }>>([])

    const [streaming, setStreaming] = useState<StreamingState>({
        content: '',
        thinkingContent: '',
        isThinkingStreaming: false,
    })

    // btw side-question state
    const [btwItem, setBtwItem] = useState<{ question: string; answer: string; isStreaming: boolean } | null>(null)

    // Token usage tracking
    const [tokenUsage, setTokenUsage] = useState<{ promptTokens: number; completionTokens: number; totalTokens: number }>({ promptTokens: 0, completionTokens: 0, totalTokens: 0 })

    // Terminal resize: clear screen via Ink instance and force Static remount
    const { stdout } = useStdout()
    const [resizeKey, setResizeKey] = useState(0)
    useEffect(() => {
        if (!clearScreen) return
        const onResize = () => {
            clearScreen()
            setResizeKey(k => k + 1)
        }
        stdout.on('resize', onResize)
        return () => { stdout.off('resize', onResize) }
    }, [stdout, clearScreen])

    const [themeId, setThemeId] = useState<ThemeId>(() =>
        resolveThemeId(clientOptions.theme ?? process.env['LOP_THEME']),
    )

    const applyTheme = useCallback((rawId: string): boolean => {
        const id = tryParseThemeId(rawId)
        if (!id) return false
        setThemeId(id)
        return true
    }, [])

    const themeControl = useMemo(
        () => ({
            currentId: themeId,
            applyTheme,
            listBuiltins: listBuiltinThemes,
        }),
        [themeId, applyTheme],
    )

    // Ref to access latest streaming content in 'done' callback
    // Note: This is updated synchronously in handleEvent to avoid React batching issues
    const streamingRef = useRef('')

    const handleEvent = useCallback((event: any) => {
        switch (event.type) {
            case 'content':
                // Sync update ref BEFORE setStreaming to avoid React batching issues
                // When multiple content events fire rapidly, React may batch them,
                // causing the ref to lag behind. Synchronous update ensures done
                // event always sees the complete content.
                streamingRef.current += event.delta
                setStreaming(prev => ({ ...prev, content: prev.content + event.delta }))
                break
            case 'reasoning':
                setStreaming(prev => ({
                    ...prev,
                    thinkingContent: prev.thinkingContent + event.delta,
                    isThinkingStreaming: true,
                }))
                break
            case 'reasoning_end':
                setStreaming(prev => {
                    if (prev.thinkingContent) {
                        setMessages(msgs => [...msgs, {
                            id: `thinking-${Date.now()}`,
                            role: 'thinking' as const,
                            content: prev.thinkingContent,
                            isStreaming: false,
                            timestamp: Date.now(),
                        } as Message])
                    }
                    return { ...prev, thinkingContent: '', isThinkingStreaming: false }
                })
                break
            case 'tool_call':
                // 记录开始时间
                pendingCallsRef.current.set(event.id, {
                    id: event.id,
                    name: event.name,
                    startTime: Date.now(),
                })
                setMessages(prev => [...prev, {
                    id: `tool-${Date.now()}`,
                    role: 'tool' as const,
                    timestamp: Date.now(),
                    toolCall: {
                        id: event.id,
                        name: event.name,
                        args: event.args,
                        status: 'running',
                    },
                }])
                break
            case 'tool_result':
                // 计算耗时并更新统计
                const pendingCall = pendingCallsRef.current.get(event.id)
                if (pendingCall) {
                    pendingCallsRef.current.delete(event.id)
                    const elapsed = Date.now() - pendingCall.startTime

                    setToolStats(prev => {
                        const newStats = new Map(prev)
                        const existing = newStats.get(pendingCall.name) ?? {
                            name: pendingCall.name,
                            calls: 0,
                            success: 0,
                            failed: 0,
                            totalTime: 0,
                        }
                        newStats.set(pendingCall.name, {
                            name: pendingCall.name,
                            calls: existing.calls + 1,
                            success: existing.success + (event.isError ? 0 : 1),
                            failed: existing.failed + (event.isError ? 1 : 0),
                            totalTime: existing.totalTime + elapsed,
                        })
                        return newStats
                    })
                }

                setMessages(prev => prev.map(msg => {
                    if (msg.role === 'tool' && msg.toolCall.id === event.id) {
                        return {
                            ...msg,
                            toolCall: {
                                ...msg.toolCall,
                                status: event.isError ? 'error' : 'success',
                                result: event.content,
                            }
                        }
                    }
                    return msg
                }))
                break
            case 'ask_question':
                setPendingQuestions(prev => {
                    if (prev.some(q => q.requestId === event.requestId)) {
                        getGlobalLogger().warn('ask_question', `Duplicate requestId ignored: ${event.requestId}`)
                        return prev
                    }
                    return [...prev, {
                        requestId: event.requestId,
                        questions: event.questions,
                    }]
                })
                break
            case 'permission_request':
                setPendingPermissions(prev => {
                    if (prev.some(p => p.requestId === event.requestId)) return prev
                    return [...prev, {
                        requestId: event.requestId,
                        toolName: event.toolName,
                        summary: event.summary,
                    }]
                })
                break
            case 'context_compressed':
                setMessages(prev => [...prev, {
                    id: `system-${Date.now()}`,
                    role: 'assistant' as const,
                    content: `ℹ️ Context compressed: ~${Math.round(event.tokensBefore / 1000)}K → ~${Math.round(event.tokensAfter / 1000)}K estimated tokens (session was approaching limit).`,
                    timestamp: Date.now(),
                }])
                break
            case 'btw_content':
                setBtwItem(prev => prev ? { ...prev, answer: prev.answer + event.delta } : null)
                break
            case 'btw_done':
                setBtwItem(prev => prev ? { ...prev, isStreaming: false } : null)
                break
            case 'done':
                if (event.usage) {
                    // Agent sends cumulative session totals — replace, not add
                    setTokenUsage(event.usage)
                }
                getGlobalLogger().info('done',`${streamingRef.current}`)
                if (streamingRef.current) {
                    setMessages(prev => [...prev, {
                        id: `assistant-${Date.now()}`,
                        role: 'assistant' as const,
                        content: streamingRef.current,
                        timestamp: Date.now(),
                    }])
                }
                if (event.finishReason && event.finishReason.startsWith('error')) {
                    const reasonText = event.finishReason.length > 100
                        ? event.finishReason.slice(0, 100) + '...'
                        : event.finishReason
                    setMessages(prev => [...prev, {
                        id: `system-${Date.now()}`,
                        role: 'assistant' as const,
                        content: `⚠️ ${reasonText}`,
                        timestamp: Date.now(),
                    }])
                }
                setStreaming({ content: '', thinkingContent: '', isThinkingStreaming: false })
                setIsLoading(false)
                streamingRef.current = ''

                break
        }
    }, [])

    const { client, isReady, error, sessionId } = useClient({
        ...clientOptions,
        onEvent: handleEvent,
    })

    const uiOps = {
        addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => {
            setMessages(prev => [...prev, {
                ...message,
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                timestamp: Date.now(),
            } as Message])
        },
        addSystemMessage: (content: string, isError: boolean = false) => {
            setMessages(prev => [...prev, {
                id: `system-${Date.now()}`,
                role: 'assistant' as const,
                content: isError ? `❌ ${content}` : `ℹ️ ${content}`,
                timestamp: Date.now(),
            } as Message])
        },
        clearMessages: () => setMessages([]),
        setLoading: (loading: boolean) => setIsLoading(loading),
        getToolStats: () => toolStats,
        getTokenUsage: () => tokenUsage,
    }

    const config: LopConfig & { cwd: string } = {
        provider: clientOptions.provider as LopConfig['provider'],
        model: clientOptions.model,
        apiKey: clientOptions.apiKey,
        baseURL: clientOptions.baseURL,
        debug: clientOptions.debug,
        cwd: clientOptions.cwd ?? process.cwd(),
    }

    const { registry, processInput } = useSlashCommandProcessor({
        client,
        config,
        ui: uiOps,
        quit: exit,
        theme: themeControl,
    })

    const handleSubmit = useCallback(async (input: string) => {
        if (!input.trim()) return

        setIsCommandRunning(true)
        let result: Awaited<ReturnType<typeof processInput>>
        try {
            result = await processInput(input)
        } finally {
            setIsCommandRunning(false)
        }

        switch (result.type) {
            case 'handled':
                break
            case 'quit':
                exit()
                break
            case 'submit_prompt':
                if (!client) return
                setMessages(prev => [...prev, {
                    id: `user-${Date.now()}`,
                    role: 'user' as const,
                    content: result.content,
                    timestamp: Date.now(),
                } as Message])
                setIsLoading(true)


                try {
                    await client.chat(result.content, config.cwd)
                } catch (error) {
                    setMessages(prev => [...prev, {
                        id: `error-${Date.now()}`,
                        role: 'assistant' as const,
                        content: `Error: ${getErrorMessage(error)}`,
                        timestamp: Date.now(),
                    } as Message])
                    setIsLoading(false)

                }
                break
            case 'btw':
                if (!client) return
                setBtwItem({ question: result.question, answer: '', isStreaming: true })
                client.btw(result.question).catch(err => {
                    setBtwItem(prev => prev
                        ? { ...prev, isStreaming: false, answer: prev.answer || `Error: ${getErrorMessage(err)}` }
                        : null)
                })
                break
        }
    }, [client, config.cwd, processInput, exit])

    const handleInterrupt = useCallback(async () => {
        if (client) {
            await client.interrupt()
        }
        setIsLoading(false)

        setStreaming({ content: '', thinkingContent: '', isThinkingStreaming: false })
        streamingRef.current = ''
        setPendingQuestions([])
        setPendingPermissions([])
    }, [client])

    const pendingQuestion = pendingQuestions[0] ?? null

    const handleQuestionSubmit = useCallback(async (answers: Record<string, string>) => {
        if (!client || !pendingQuestion) return
        await client.respondToQuestion(pendingQuestion.requestId, answers)
        setPendingQuestions(prev => prev.slice(1))
    }, [client, pendingQuestion])

    const handleQuestionCancel = useCallback(async () => {
        if (!client || !pendingQuestion) return
        await client.respondToQuestion(pendingQuestion.requestId, undefined, true)
        setPendingQuestions(prev => prev.slice(1))
    }, [client, pendingQuestion])

    const pendingPermission = pendingPermissions[0] ?? null

    const handlePermissionDecide = useCallback(async (outcome: PermissionOutcome) => {
        if (!client || !pendingPermission) return
        await client.respondToPermission(pendingPermission.requestId, outcome)
        setPendingPermissions(prev => prev.slice(1))
    }, [client, pendingPermission])

    const handleClear = useCallback(async () => {
        if (client) {
            await client.clear()
            setMessages([])
            setPendingQuestions([])
        }
    }, [client])

    const handleBtwDismiss = useCallback(() => {
        setBtwItem(null)
    }, [])

    const handleBtwCancel = useCallback(async () => {
        setBtwItem(null)
        if (client) {
            await client.interruptBtw()
        }
    }, [client])

    return (
        <ThemeProvider themeId={themeId}>
            {error ? (
                <Box padding={0} flexDirection="column">
                    <Header
                        model={clientOptions.model ?? 'unknown'}
                        provider={clientOptions.provider ?? 'unknown'}
                        sessionId={sessionId}
                    />
                    <Box marginTop={0}>
                        <InitErrorText message={error} />
                    </Box>
                </Box>
            ) : (
                <Box flexDirection="column" padding={0} marginBottom={0}>
                    <Header {...{ model: clientOptions.model ?? 'unknown', provider: clientOptions.provider ?? 'unknown', sessionId }} />
                    <MessageList
                        key={resizeKey}
                        messages={messages}
                        streaming={streaming}
                        isLoading={isLoading}
                    />
                    {isLoading && (
                        <LoadingIndicator />
                    )}
                    {pendingPermission && (
                        <PermissionPrompt
                            toolName={pendingPermission.toolName}
                            summary={pendingPermission.summary}
                            onDecide={handlePermissionDecide}
                        />
                    )}
                    {pendingQuestion && (
                        <AskQuestionDialog
                            questions={pendingQuestion.questions}
                            onSubmit={handleQuestionSubmit}
                            onCancel={handleQuestionCancel}
                        />
                    )}
                    {btwItem && (
                        <BtwMessage
                            question={btwItem.question}
                            answer={btwItem.answer}
                            isStreaming={btwItem.isStreaming}
                            onDismiss={handleBtwDismiss}
                            onCancel={handleBtwCancel}
                        />
                    )}
                    <InputBox
                        onSubmit={handleSubmit}
                        onClear={handleClear}
                        onInterrupt={handleInterrupt}
                        disabled={isLoading || isCommandRunning || !isReady || pendingQuestion !== null || pendingPermission !== null}
                        commands={registry.getVisibleCommands()}
                    />
                </Box>
            )}
        </ThemeProvider>
    )
}

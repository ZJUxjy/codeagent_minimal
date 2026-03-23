import React, { useState, useCallback, useRef, useEffect } from 'react'
import { Box, Text, useApp } from 'ink'
import { Header } from './components/Header.js'
import { MessageList } from './components/MessageList.js'
import { InputBox } from './components/InputBox.js'
import { LoadingIndicator } from './components/LoadingIndicator.js'
import { useClient } from './hooks/useClient.js'
import { useSlashCommandProcessor } from './hooks/useSlashCommandProcessor.js'
import type { Message } from './types.js'
import type { ClientOptions } from '../client/index.js'
import type { LopConfig } from '../protocol/types.js'

interface AppProps {
    clientOptions: ClientOptions
}

export const App: React.FC<AppProps> = ({ clientOptions }) => {
    const { exit } = useApp()

    // 状态
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [streamingContent, setStreamingContent] = useState('')

    // 用 ref 存储 streamingContent，让事件处理器能访问最新值
    const streamingContentRef = useRef('')
    useEffect(() => {
        streamingContentRef.current = streamingContent
    }, [streamingContent])

    // 事件处理器
    const handleEvent = useCallback((event: any) => {
        switch (event.type) {
            case 'content':
                setStreamingContent(prev => prev + event.delta)
                break
            case 'tool_call':
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
            case 'done':
                if (streamingContentRef.current) {
                    setMessages(prev => [...prev, {
                        id: `assistant-${Date.now()}`,
                        role: 'assistant' as const,
                        content: streamingContentRef.current,
                        timestamp: Date.now(),
                    }])
                    setStreamingContent('')
                }
                setIsLoading(false)
                break
        }
    }, [])

    const { client, isReady, error } = useClient({
        ...clientOptions,
        onEvent: handleEvent,
    })

    // UI 操作对象
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
    }

    // 配置对象
    const config: LopConfig & { cwd: string } = {
        provider: clientOptions.provider as LopConfig['provider'],
        model: clientOptions.model,
        apiKey: clientOptions.apiKey,
        baseURL: clientOptions.baseURL,
        debug: clientOptions.debug,
        cwd: clientOptions.cwd ?? process.cwd(),
    }

    // Slash 命令处理器
    const { registry, processInput } = useSlashCommandProcessor({
        client,
        config,
        ui: uiOps,
        quit: exit,
    })

    // 处理用户输入
    const handleSubmit = useCallback(async (input: string) => {
        if (!input.trim()) return

        const result = await processInput(input)

        switch (result.type) {
            case 'handled':
                // 命令已处理
                break
            case 'quit':
                exit()
                break
            case 'submit_prompt':
                // 作为普通消息发送到 LLM
                if (!client) return

                // 添加用户消息
                setMessages(prev => [...prev, {
                    id: `user-${Date.now()}`,
                    role: 'user' as const,
                    content: result.content,
                    timestamp: Date.now(),
                } as Message])
                setIsLoading(true)

                try {
                    await client.chat(result.content, config.cwd)
                } catch (error: any) {
                    setMessages(prev => [...prev, {
                        id: `error-${Date.now()}`,
                        role: 'assistant' as const,
                        content: `Error: ${error.message}`,
                        timestamp: Date.now(),
                    } as Message])
                    setIsLoading(false)
                }
                break
        }
    }, [client, config.cwd, processInput, exit])

    const handleClear = useCallback(async () => {
        if (client) {
            await client.clear()
            setMessages([])
        }
    }, [client])

    // 显示错误状态
    if (error) {
        return (
            <Box padding={1} flexDirection="column">
                <Header
                    model={clientOptions.model ?? 'unknown'}
                    provider={clientOptions.provider ?? 'unknown'}
                />
                <Box marginTop={1}>
                    <Text color="red">Failed to initialize: {error}</Text>
                </Box>
            </Box>
        )
    }

    return (
        <Box flexDirection='column' padding={1}>
            <Header
                model={clientOptions.model ?? 'unknown'}
                provider={clientOptions.provider ?? 'unknown'}
            />
            <MessageList
                messages={messages}
                streamingContent={streamingContent}
            />
            {isLoading && <LoadingIndicator />}
            <InputBox
                onSubmit={handleSubmit}
                onClear={handleClear}
                disabled={isLoading || !isReady}
                commands={registry.getVisibleCommands()}
            />
        </Box>
    )
}

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Header } from './components/Header.js';
import { MessageList } from './components/MessageList.js';
import { InputBox } from './components/InputBox.js';
import { LoadingIndicator } from './components/LoadingIndicator.js';
import { useClient } from './hooks/useClient.js';
import type { Message } from './types.js';
import type { ClientEvent, ClientOptions } from '../client/index.js';

interface AppProps {
    clientOptions: ClientOptions
}

export const App: React.FC<AppProps> = ({ clientOptions }) => {
    const [messages, setMessages] = useState<Message[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [streamingContent, setStreamingContent] = useState('')

    // 用 ref 存储 streamingContent，让事件处理器能访问最新值
    const streamingContentRef = useRef('')
    useEffect(() => {
        streamingContentRef.current = streamingContent
    }, [streamingContent])

    // 事件处理器
    const handleEvent = useCallback((event: ClientEvent) => {
        switch (event.type) {
            case 'content':
                setStreamingContent(prev => prev + event.delta)
                break
            case 'tool_call':
                setMessages(prev => [...prev, {
                    id: `tool-${Date.now()}`,
                    role: 'tool',
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
                        };
                    }
                    return msg
                }))
                break
            case 'done':
                // 使用 ref 获取最新的 streamingContent
                if (streamingContentRef.current) {
                    setMessages(prev => [...prev, {
                        id: `assistant-${Date.now()}`,
                        role: 'assistant',
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

    const handleSubmit = useCallback(async (input: string) => {
        if (!input.trim() || !client) return

        setMessages(prev => [...prev, {
            id: `user-${Date.now()}`,
            role: 'user',
            content: input,
            timestamp: Date.now(),
        }])
        setIsLoading(true)

        try {
            await client.chat(input, clientOptions.cwd)
        } catch (error: any) {
            setMessages(prev => [...prev, {
                id: `error-${Date.now()}`,
                role: 'assistant',
                content: `Error: ${error.message}`,
                timestamp: Date.now(),
            }])
            setIsLoading(false)
        }
    }, [client, clientOptions.cwd])

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
            />
        </Box>
    )
}

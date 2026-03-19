import { streamText } from "ai"
import { openai, createOpenAI } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import type { CoreMessage, Tool } from "ai"

// ============ 类型定义 ============

export type Provider = "openai" | "anthropic" | "openrouter" | "minimax"

export interface LLMConfig {
    provider: Provider
    model: string
    apiKey?: string
    baseURL?: string
    debug?: boolean
}

export type StreamEvent =
    | { type: "content"; delta: string }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "done"; finishReason: string }

export class LLMClient {
    private config: LLMConfig
    private debug: boolean

    constructor(config: LLMConfig) {
        this.config = config
        this.debug = config.debug ?? false
    }

    private log(...args: unknown[]): void {
        if (this.debug) {
            console.error("[LLM]", ...args)
        }
    }

    private getModel() {
        switch (this.config.provider) {
            case "openai":
                if (this.config.baseURL) {
                    const customOpenAI = createOpenAI({
                        baseURL: this.config.baseURL,
                        apiKey: this.config.apiKey,
                    })
                    return customOpenAI(this.config.model)
                }
                return openai(this.config.model)

            case "anthropic":
                return anthropic(this.config.model)

            case "openrouter":
                const openrouter = createOpenAI({
                    baseURL: this.config.baseURL ?? "https://openrouter.ai/api/v1",
                    apiKey: this.config.apiKey,
                })
                return openrouter(this.config.model)

            case "minimax":
                // MiniMax 使用 OpenAI 兼容 API
                const minimax = createOpenAI({
                    baseURL: this.config.baseURL ?? "https://api.minimaxi.com/v1",
                    apiKey: this.config.apiKey,
                })
                return minimax(this.config.model)

            default:
                throw new Error(`Unknown provider: ${this.config.provider}`)
        }
    }

    /**
     * 流式调用 LLM
     * @param messages 对话历史
     * @param tools 可用工具定义
     * @yields StreamEvent 流式事件
     */
    async *stream(messages: CoreMessage[], tools: Record<string, { description: string; parameters: unknown }>): AsyncGenerator<StreamEvent> {
        const model = this.getModel()

        this.log(`Starting stream with ${messages.length} messages`)

        const toolDefs: Record<string, Tool> = {}
        for (const [name, def] of Object.entries(tools)) {
            toolDefs[name] = {
                description: def.description,
                parameters: def.parameters as any,
            }
        }

        try {
            this.log(`Calling streamText...`)
            const result = streamText({
                model, messages, tools: toolDefs, maxSteps: 10,
            })

            this.log(`Stream created, starting iteration...`)

            // 遍历流式输出
            try {
                for await (const chunk of result.fullStream) {
                    this.log(`Chunk type: ${chunk.type}`)

                    if (chunk.type === "text-delta") {
                        // 文本增量
                        yield { type: "content", delta: chunk.textDelta }
                    } else if (chunk.type === "tool-call") {
                        yield {
                            type: "tool_call",
                            id: chunk.toolCallId,
                            name: chunk.toolName,
                            args: chunk.args as Record<string, unknown>,
                        }
                    } else if (chunk.type === "error") {
                        // API 错误
                        this.log(`API Error:`, chunk.error)
                        yield { type: "done", finishReason: `error: ${chunk.error}` }
                        return
                    }
                }
            } catch (streamError: any) {
                this.log(`Stream error:`, streamError)
                throw streamError
            }

            // 流结束，发送完成事件
            const finalResult = await result
            const finishReason = typeof finalResult.finishReason === 'string'
                ? finalResult.finishReason
                : 'stop'
            this.log(`Stream completed, finishReason: ${finishReason}`)
            yield {
                type: "done",
                finishReason,
            }
        } catch (error: any) {
            this.log(`Error:`, error)
            this.log(`Error stack:`, error.stack)
            yield { type: "done", finishReason: `error: ${error.message}` }
        }
    }
}

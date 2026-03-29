import { streamText, generateText } from "ai"
import { openai, createOpenAI } from "@ai-sdk/openai"
import { anthropic, createAnthropic } from "@ai-sdk/anthropic"
import { google } from "@ai-sdk/google"
import type { CoreMessage, Tool } from "ai"
import { createThinkTagParser } from "./utils/thinkTagParser.js"
import type { Provider } from "./protocol/types.js"

// Re-export Provider for backward compatibility
export { type Provider } from "./protocol/types.js"

/**
 * Normalizes baseURL for Anthropic-compatible APIs (ensures /v1 suffix, deduplicates slashes).
 */
export function normalizeAnthropicCompatibleBaseURL(baseURL: string | undefined, fallback: string): string {
    const use = (baseURL?.trim() || fallback).trim()
    let u = use.replace(/\/+$/, "")
    if (!u.endsWith("/v1")) u = `${u}/v1`
    const schemeSep = u.indexOf("://")
    if (schemeSep !== -1) {
        return u.slice(0, schemeSep + 3) + u.slice(schemeSep + 3).replace(/\/+/g, "/")
    }
    return u.replace(/\/+/g, "/")
}

export interface LLMConfig {
    provider: Provider
    model: string
    apiKey?: string
    baseURL?: string
    debug?: boolean
}

export interface TokenUsage {
    promptTokens: number
    completionTokens: number
    totalTokens: number
}

export type StreamEvent =
    | { type: "content"; delta: string }
    | { type: "reasoning"; delta: string }
    | { type: "reasoning_end" }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "done"; finishReason: string; usage?: TokenUsage }

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

    private makeAnthropicCompatModel(defaultBaseURL: string, extraHeaders?: Record<string, string>) {
        const client = createAnthropic({
            baseURL: normalizeAnthropicCompatibleBaseURL(this.config.baseURL, defaultBaseURL),
            apiKey: this.config.apiKey,
            ...(extraHeaders ? { headers: extraHeaders } : {}),
        })
        return client(this.config.model)
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
                // MiniMax uses Bearer token auth instead of x-api-key
                return this.makeAnthropicCompatModel("https://api.minimaxi.com/anthropic/v1", {
                    Authorization: `Bearer ${this.config.apiKey}`,
                })

            case "google":
                return google(this.config.model)

            case "kimi":
                return this.makeAnthropicCompatModel("https://api.kimi.com/coding")

            case "glm":
                return this.makeAnthropicCompatModel("https://open.bigmodel.cn/api/anthropic")

            default:
                throw new Error(`Unknown provider: ${this.config.provider}`)
        }
    }

    /**
     * Non-streaming completion — returns the full text response.
     * Used for context compression summarization.
     */
    async complete(systemPrompt: string, messages: CoreMessage[], signal?: AbortSignal): Promise<string> {
        const model = this.getModel()
        const result = await generateText({
            model,
            system: systemPrompt,
            messages,
            abortSignal: signal,
        })
        return result.text
    }

    /**
     * Stream LLM responses with tool support.
     */
    async *stream(messages: CoreMessage[], tools: Record<string, { description: string; parameters: unknown }>, options?: { system?: string }): AsyncGenerator<StreamEvent> {
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
                model,
                ...(options?.system ? { system: options.system } : {}),
                messages,
                tools: toolDefs,
                maxSteps: 10,
                ...(this.config.provider === "anthropic" && {
                    providerOptions: {
                        anthropic: {
                            thinking: { type: "enabled", budgetTokens: 16000 },
                        },
                    },
                    headers: {
                        "anthropic-beta": "interleaved-thinking-2025-05-14",
                    },
                }),
                ...(this.config.provider === "google" && {
                    providerOptions: {
                        google: {
                            thinkingConfig: {
                                thinkingBudget: 8192,
                                includeThoughts: true,
                            },
                        },
                    },
                }),
            })

            this.log(`Stream created, starting iteration...`)

            const thinkParser = createThinkTagParser()

            try {
                // tracks whether the previous chunk was a native reasoning chunk from AI SDK
                let wasReasoning = false

                for await (const chunk of result.fullStream) {
                    this.log(`Chunk type: ${chunk.type}`)

                    if (chunk.type === "text-delta") {
                        if (wasReasoning) {
                            yield { type: "reasoning_end" }
                            wasReasoning = false
                        }

                        const text = chunk.textDelta
                        const events = thinkParser.feed(text)
                        for (const event of events) {
                            yield event
                        }
                    } else if (chunk.type === "reasoning") {
                        wasReasoning = true
                        const textDelta = (chunk as unknown as { textDelta?: string }).textDelta
                        if (textDelta) {
                            yield { type: "reasoning", delta: textDelta }
                        }
                    } else if (chunk.type === "tool-call") {
                        if (wasReasoning) {
                            yield { type: "reasoning_end" }
                            wasReasoning = false
                        }
                        yield {
                            type: "tool_call",
                            id: chunk.toolCallId,
                            name: chunk.toolName,
                            args: chunk.args as Record<string, unknown>,
                        }
                    } else if (chunk.type === "error") {
                        this.log(`API Error:`, chunk.error)
                        yield { type: "done", finishReason: `error: ${chunk.error}` }
                        return
                    } else if (chunk.type === "step-finish" || chunk.type === "finish") {
                        if (wasReasoning) {
                            yield { type: "reasoning_end" }
                            wasReasoning = false
                        }
                        if (thinkParser.isInThink()) {
                            yield { type: "reasoning_end" }
                        }
                    }
                }
            } catch (streamError: any) {
                this.log(`Stream error:`, streamError)
                throw streamError
            }

            for (const event of thinkParser.flush()) {
                yield event
            }

            const finalResult = await result
            const finishReason = typeof finalResult.finishReason === 'string'
                ? finalResult.finishReason
                : 'stop'
            this.log(`Stream completed, finishReason: ${finishReason}`)

            // Extract token usage from Vercel AI SDK result
            const usage = await finalResult.usage
            const tokenUsage: TokenUsage | undefined = usage
                ? {
                    promptTokens: usage.promptTokens ?? 0,
                    completionTokens: usage.completionTokens ?? 0,
                    totalTokens: (usage.promptTokens ?? 0) + (usage.completionTokens ?? 0),
                }
                : undefined

            yield {
                type: "done",
                finishReason,
                usage: tokenUsage,
            }
        } catch (error: any) {
            this.log(`Error:`, error)
            this.log(`Error stack:`, error.stack)
            yield { type: "done", finishReason: `error: ${error.message}`, usage: undefined }
        }
    }
}

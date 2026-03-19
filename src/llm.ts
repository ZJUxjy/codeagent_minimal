import { streamText } from "ai"
import { openai, createOpenAI } from "@ai-sdk/openai"
import { anthropic } from "@ai-sdk/anthropic"
import type { CoreMessage, Tool } from "ai"

// ============ 类型定义 ============

export type Provider = "openai" | "anthropic" | "openrouter"

export interface LLMConfig {
    provider: Provider
    model: string
}

export type StreamEvent =
    | { type: "content"; delta: string }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "done"; finishReason: string }

export class LLMClient {
    private config: LLMConfig
    constructor(config: LLMConfig) {
        this.config = config
    }
    private getModel() {
        switch (this.config.provider) {
            case "openai":
                return openai(this.config.model)
            case "anthropic":
                return anthropic(this.config.model)
            case "openrouter":
                const openrouter = createOpenAI({
                    baseURL: "https://openrouter.ai/api/v1",
                })
                return openrouter(this.config.model)
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

        const toolDefs: Record<string, Tool> = {}
        for (const [name, def] of Object.entries(tools)) {
            toolDefs[name] = {
                description: def.description,
                parameters: def.parameters as any,
            }
        }
        const result = await streamText({
            model, messages, tools: toolDefs, maxSteps: 10,
        })

        // 遍历流式输出
        for await (const chunk of result.fullStream) {
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
            }
        }

        // 流结束，发送完成事件
        const finalResult = await result
        yield {
            type: "done",
            finishReason: String(finalResult.finishReason ?? "stop"),
        }
    }
}
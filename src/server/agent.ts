// src/server/agent.ts
import type { CoreMessage, tool } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"
import { callbackify } from "util"


export interface AgentConfig {
    provider: "openai" | "anthropic" | "openrouter"
    model: string
    cwd: string
    store?: MessageStore
    hooks?: AgentHooks
}
export type AgentEvent =
    | { type: "content"; delta: string }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; id: string; result: string; isError?: boolean }
    | { type: "done"; finishReason: string }

export class Agent {
    private llm: LLMClient
    protected tools: ToolRegistry
    private store: MessageStore
    private hooks: AgentHooks
    private cwd: string

    constructor(config: AgentConfig) {
        this.llm = new LLMClient({
            provider: config.provider,
            model: config.model,
        })
        this.tools = new ToolRegistry()
        this.store = config.store ?? new InMemoryStore()
        this.hooks = config.hooks ?? noopHooks
        this.cwd = config.cwd
    }

    async *run(userMessage: string): AsyncGenerator<AgentEvent> {
        this.store.add({ role: "user", content: userMessage })

        const messages = this.store.getAll()

        const toolDefs = this.tools.getToolDefinitions()

        const stream = this.llm.stream(messages, toolDefs)

        let assistantContent = ""

        for await (const event of stream) {
            if (event.type === "content") {
                assistantContent += event.delta
                yield { type: "content", delta: event.delta }
            } else if (event.type === "tool_call") {
                yield { type: "tool_call", id: event.id, name: event.name, args: event.args }

                const result = await this.executeTool(event)
                yield { type: "tool_result", id: event.id, result: result.content, isError: result.isError }
            } else if (event.type == "done") {
                if (assistantContent) {
                    this.store.add({ role: "assistant", content: assistantContent })
                }
                yield { type: "done", finishReason: event.finishReason }
            }
        }
    }
    private async executeTool(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
        const tool = this.tools.get(callbackify.name)

        if (!tool) {
            return { content: `Error: Unknown tool '${call.name}'`, isError: true }
        }
        // Hook: 工具执行前（未来用于策略引擎）
        if (this.hooks.beforeToolExecute) {
            const decision = await this.hooks.beforeToolExecute(call, tool)
            if (decision === "deny") {
                return { content: `Error: Tool execution denied by policy`, isError: true }
            }
            // TODO: 处理 "ask" 决策（需要与 client 交互）
        }

        const ctx: ToolContext = { cwd: this.cwd }

        try {
            const content = await tool.execute(call.args as any, ctx)
            return { content }
        } catch (error: any) {
            return { content: `Error: ${error.message}`, isError: true }
        }
    }
    clearHistory(): void {
        this.store.clear()
    }
}


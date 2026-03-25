// src/server/agent.ts
import type { CoreMessage, ToolContent } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry, type ToolRegistryOptions } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"
import type { LopConfig, Provider } from "../protocol/types.js"
import { evaluateToolPolicy } from "./security/policy.js"
import { createDelegationTool } from "./tools/delegateTool.js"

export interface AgentConfig {
    provider: Provider
    model: string
    cwd: string
    apiKey?: string
    baseURL?: string
    debug?: boolean
    store?: MessageStore
    hooks?: AgentHooks
    mcpConfig?: Pick<LopConfig, "mcpServers" | "mcp">
    /** When set, skips constructing a default registry (child agents). */
    tools?: ToolRegistry
    /** Max outer turns; default 10. Child runs often use a lower value. */
    maxTurns?: number
}

export type AgentEvent =
    | { type: "content"; delta: string }
    | { type: "reasoning"; delta: string }
    | { type: "reasoning_end" }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; id: string; content: string; isError?: boolean }
    | { type: "done"; finishReason: string }

/** Config needed to spawn a child Agent (no store/tools). */
export type AgentConfigSnapshot = Omit<AgentConfig, "store" | "tools">

export class Agent {
    private llm: LLMClient
    private tools: ToolRegistry
    private store: MessageStore
    private hooks: AgentHooks
    private cwd: string
    private readonly maxTurns: number
    private readonly snapshot: AgentConfigSnapshot
    private activeSignal?: AbortSignal

    constructor(config: AgentConfig) {
        const { store, tools, mcpConfig, maxTurns, hooks, ...snapshot } = config
        this.snapshot = {
            ...snapshot,
            ...(mcpConfig !== undefined ? { mcpConfig } : {}),
            ...(hooks !== undefined ? { hooks } : {}),
        }
        this.maxTurns = maxTurns ?? 10
        this.llm = new LLMClient({
            provider: config.provider,
            model: config.model,
            apiKey: config.apiKey,
            baseURL: config.baseURL,
            debug: config.debug,
        })
        const registryOptions: ToolRegistryOptions = config.mcpConfig?.mcpServers
            ? { mcpServers: config.mcpConfig.mcpServers }
            : {}
        this.tools = config.tools ?? new ToolRegistry(registryOptions)
        this.store = config.store ?? new InMemoryStore()
        this.hooks = config.hooks ?? noopHooks
        this.cwd = config.cwd
        if (!config.tools) {
            this.registerDelegationTool()
        }
    }

    /** Parameters for constructing a child agent (shared LLM settings, cwd, hooks, mcp). */
    getConfigSnapshot(): AgentConfigSnapshot {
        return { ...this.snapshot }
    }

    getToolsRegistry(): ToolRegistry {
        return this.tools
    }

    registerDelegationTool(): void {
        if (this.tools.get("agent")) {
            return
        }
        this.tools.register(createDelegationTool(() => this))
    }

    async discoverMcpTools(): Promise<void> {
        await this.tools.discoverMcpTools()
    }

    getMcpManager() {
        return this.tools.getMcpManager()
    }

    async *run(userMessage: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        this.store.add({ role: "user", content: userMessage })
        yield* this.runLoop(signal)
    }

    /** Run with whatever is already in {@link store} (e.g. system + user seeded for subagents). */
    async *runSeeded(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        yield* this.runLoop(signal)
    }

    private async *runLoop(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        this.activeSignal = signal
        const toolDefs = this.tools.getToolDefinitions()
        const store = this.store

        function isAborted(): boolean {
            return Boolean(signal?.aborted)
        }

        const persistAssistantStep = (
            assistantContent: string,
            toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>,
        ): void => {
            if (assistantContent || toolCalls.length > 0) {
                store.add({
                    role: "assistant",
                    content: assistantContent,
                    toolInvocations: toolCalls,
                } as CoreMessage)
            }
        }

        try {
            for (let turn = 0; turn < this.maxTurns; turn++) {
                if (isAborted()) {
                    yield { type: "done", finishReason: "interrupted" }
                    return
                }

                const stream = this.llm.stream(store.getAll(), toolDefs)
                let assistantContent = ""
                const toolCallsThisTurn: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = []
                let hadToolCall = false
                let finishReason = "stop"

                for await (const event of stream) {
                    if (isAborted()) {
                        persistAssistantStep(assistantContent, toolCallsThisTurn)
                        yield { type: "done", finishReason: "interrupted" }
                        return
                    }

                    if (event.type === "content") {
                        assistantContent += event.delta
                        yield { type: "content", delta: event.delta }

                    } else if (event.type === "reasoning") {
                        yield { type: "reasoning", delta: event.delta }

                    } else if (event.type === "reasoning_end") {
                        yield { type: "reasoning_end" }

                    } else if (event.type === "tool_call") {
                        if (isAborted()) {
                            persistAssistantStep(assistantContent, toolCallsThisTurn)
                            yield { type: "done", finishReason: "interrupted" }
                            return
                        }

                        hadToolCall = true
                        toolCallsThisTurn.push({
                            toolCallId: event.id,
                            toolName: event.name,
                            args: event.args,
                        })
                        yield { type: "tool_call", id: event.id, name: event.name, args: event.args }

                        const result = await this.executeTool(event)
                        const toolContent: ToolContent = [
                            { type: "tool-result", toolCallId: event.id, toolName: event.name, result: result.content, isError: result.isError },
                        ]
                        this.store.add({
                            role: "tool",
                            content: toolContent,
                        } as CoreMessage)
                        yield { type: "tool_result", id: event.id, content: result.content, isError: result.isError }

                    } else if (event.type === "done") {
                        finishReason = event.finishReason
                    }
                }

                persistAssistantStep(assistantContent, toolCallsThisTurn)

                if (!hadToolCall || finishReason.startsWith("error")) {
                    yield { type: "done", finishReason }
                    return
                }
            }

            yield { type: "done", finishReason: "length" }
        } finally {
            this.activeSignal = undefined
        }
    }

    private async executeTool(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
        const tool = this.tools.get(call.name)

        if (!tool) {
            return { content: `Error: Unknown tool '${call.name}'`, isError: true }
        }

        const policyDecision = evaluateToolPolicy(call.name, call.args)
        if (policyDecision === "deny") {
            return { content: `Error: Tool execution denied by security policy`, isError: true }
        }
        if (policyDecision === "ask") {
            return { content: `Error: Tool '${call.name}' requires user confirmation (security policy)`, isError: true }
        }

        if (this.hooks.beforeToolExecute) {
            const decision = await this.hooks.beforeToolExecute(call, tool)
            if (decision === "deny") {
                return { content: `Error: Tool execution denied by policy`, isError: true }
            }
        }

        const ctx: ToolContext = { cwd: this.cwd, signal: this.activeSignal }

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

    /** 替换底层 store（用于 /load 命令加载历史会话） */
    replaceStore(newStore: MessageStore): void {
        this.store = newStore
    }
}

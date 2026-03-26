// src/server/agent.ts
import type { CoreMessage, ToolContent, TextPart, ToolCallPart } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry, type ToolRegistryOptions } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"
import type { LopConfig, Provider, Question } from "../protocol/types.js"
import type { QuestionBridge } from "./questionBridge.js"
import { evaluateToolPolicy } from "./security/policy.js"
import { createDelegationTool } from "./tools/delegateTool.js"
import { listSubagents } from "./subagents/manager.js"
import { truncateMessages } from "./utils/truncateMessages.js"

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
    /** Bridge for ask_question tool support. */
    questionBridge?: QuestionBridge
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
    private questionBridge?: QuestionBridge
    private activeSignal?: AbortSignal

    constructor(config: AgentConfig) {
        const { store, tools, mcpConfig, maxTurns, hooks, questionBridge, ...snapshot } = config
        this.questionBridge = questionBridge
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

    /** Build a system-level reminder listing available subagents (if the `agent` tool is registered). */
    private async buildSubagentReminder(): Promise<string | undefined> {
        if (!this.tools.get("agent")) return undefined
        const agents = await listSubagents(this.cwd)
        if (agents.length === 0) return undefined
        const lines = agents.map(a => `- **${a.name}**: ${a.description}`)
        return `You have an \`agent\` tool to delegate sub-tasks. Available subagent profiles:\n${lines.join("\n")}`
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
        const systemPrompt = await this.buildSubagentReminder()

        function isAborted(): boolean {
            return Boolean(signal?.aborted)
        }

        const persistAssistantStep = (
            assistantContent: string,
            toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>,
        ): void => {
            if (!assistantContent && toolCalls.length === 0) return

            if (toolCalls.length === 0) {
                store.add({ role: "assistant", content: assistantContent } as CoreMessage)
            } else {
                const parts: Array<TextPart | ToolCallPart> = []
                if (assistantContent) {
                    parts.push({ type: "text", text: assistantContent })
                }
                for (const call of toolCalls) {
                    parts.push({
                        type: "tool-call",
                        toolCallId: call.toolCallId,
                        toolName: call.toolName,
                        args: call.args,
                    })
                }
                store.add({ role: "assistant", content: parts } as CoreMessage)
            }
        }

        try {
            for (let turn = 0; turn < this.maxTurns; turn++) {
                if (isAborted()) {
                    yield { type: "done", finishReason: "interrupted" }
                    return
                }

                const stream = this.llm.stream(truncateMessages(store.getAll()), toolDefs, systemPrompt ? { system: systemPrompt } : undefined)
                let assistantContent = ""
                const toolCallsThisTurn: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }> = []
                const pendingToolEvents: Array<{ id: string; name: string; args: Record<string, unknown> }> = []
                let finishReason = "stop"

                // Phase 1: consume the stream, collect content + tool calls
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
                        toolCallsThisTurn.push({
                            toolCallId: event.id,
                            toolName: event.name,
                            args: event.args,
                        })
                        pendingToolEvents.push({ id: event.id, name: event.name, args: event.args })
                        yield { type: "tool_call", id: event.id, name: event.name, args: event.args }

                    } else if (event.type === "done") {
                        finishReason = event.finishReason
                    }
                }

                // Phase 2: persist assistant BEFORE tool results (correct message order)
                persistAssistantStep(assistantContent, toolCallsThisTurn)

                // Phase 3: execute tools and add results after the assistant message
                for (const call of pendingToolEvents) {
                    if (isAborted()) {
                        yield { type: "done", finishReason: "interrupted" }
                        return
                    }

                    const result = await this.executeTool(call)
                    const toolContent: ToolContent = [
                        { type: "tool-result", toolCallId: call.id, toolName: call.name, result: result.content, isError: result.isError },
                    ]
                    this.store.add({
                        role: "tool",
                        content: toolContent,
                    } as CoreMessage)
                    yield { type: "tool_result", id: call.id, content: result.content, isError: result.isError }
                }

                if (pendingToolEvents.length === 0 || finishReason.startsWith("error")) {
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

        const ctx: ToolContext = {
            cwd: this.cwd,
            signal: this.activeSignal,
            askQuestion: this.questionBridge
                ? (questions: Question[]) => this.questionBridge!.ask(questions, this.activeSignal)
                : undefined,
        }

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

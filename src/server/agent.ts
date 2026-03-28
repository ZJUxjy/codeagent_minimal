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
import { truncateMessages, convertToolMessages } from "./utils/truncateMessages.js"
import { FileIndexManager } from "./indexing/fileIndexManager.js"
import type { Skill } from "./skills/types.js"
import { buildSkillsPromptSection } from "./skills/loader.js"
import { createSkillTool } from "./tools/skill.js"

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
    /** Pre-loaded skills metadata. */
    skills?: Skill[]
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
    private fileIndex: FileIndexManager
    private skills: Skill[]

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
        const registryOptions: ToolRegistryOptions = {
            ...(config.mcpConfig?.mcpServers ? { mcpServers: config.mcpConfig.mcpServers } : {}),
            skills: config.skills,
        }
        this.tools = config.tools ?? new ToolRegistry(registryOptions)
        this.store = config.store ?? new InMemoryStore()
        this.hooks = config.hooks ?? noopHooks
        this.cwd = config.cwd
        this.skills = config.skills ?? []
        if (!config.tools) {
            this.registerDelegationTool()
        }
        this.fileIndex = new FileIndexManager(config.cwd)
        this.fileIndex.build().catch((err) => {
            console.warn(`File index build failed, grep will use full scan: ${err.message}`)
        })
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

    private static escapeXml(str: string): string {
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    }

    private buildSkillsPrompt(skills: Skill[]): string | undefined {
        return buildSkillsPromptSection(skills)
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
        const systemParts = [
            await this.buildSubagentReminder(),
            this.buildSkillsPrompt(this.skills),
        ].filter((part): part is string => Boolean(part && part.trim()))
        const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined

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

                const stream = this.llm.stream(
                    convertToolMessages(truncateMessages(store.getAll())),
                    toolDefs,
                    systemPrompt ? { system: systemPrompt } : undefined,
                )
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

                // Phase 3: execute tools in parallel, then write results in original order
                const results = await Promise.all(
                    pendingToolEvents.map(call => this.executeTool(call))
                )

                if (isAborted()) {
                    yield { type: "done", finishReason: "interrupted" }
                    return
                }

                // Two separate loops: all store writes must complete before any yield,
                // so the store is fully consistent if a consumer reads it on receiving an event.
                for (let i = 0; i < pendingToolEvents.length; i++) {
                    const call = pendingToolEvents[i]
                    const result = results[i]
                    this.store.add({
                        role: "tool",
                        content: [{ type: "tool-result", toolCallId: call.id, toolName: call.name, result: result.content, isError: result.isError }],
                    } as CoreMessage)
                }

                for (let i = 0; i < pendingToolEvents.length; i++) {
                    const call = pendingToolEvents[i]
                    const result = results[i]
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
            fileIndex: this.fileIndex,
        }

        try {
            const content = await tool.execute(call.args as any, ctx)
            return { content }
        } catch (error: any) {
            return { content: `Error: ${error.message}`, isError: true }
        }
    }

    /** Hot-reload skills at runtime (e.g. from file watcher). */
    updateSkills(skills: Skill[]): void {
        this.skills = skills
        // Re-register skill tool with updated skills
        if (this.tools.get("skill")) {
            this.tools.register(createSkillTool(skills))
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

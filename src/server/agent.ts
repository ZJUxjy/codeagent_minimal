// src/server/agent.ts
import type { CoreMessage, TextPart, ToolCallPart } from "ai"
import { LLMClient, type TokenUsage } from "../llm.js"
import { ToolRegistry, type ToolRegistryOptions } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { loadMemories } from "./tools/memory.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"
import type { LopConfig, Provider, Question, SummaryConfig } from "../protocol/types.js"
import type { QuestionBridge } from "./questionBridge.js"
import { createDelegationTool } from "./tools/delegateTool.js"
import { listSubagents } from "./subagents/manager.js"
import { truncateMessages, convertToolMessages, estimateTokens, CHARS_PER_TOKEN, DEFAULT_MAX_TOKENS } from "./utils/truncateMessages.js"
import { shouldCompress, compressContext, type CompressionOptions } from "./compression/index.js"
import { FileIndexManager } from "./indexing/fileIndexManager.js"
import type { Skill } from "./skills/types.js"
import { buildSkillsPromptSection } from "./skills/loader.js"
import { BASE_SYSTEM_PROMPT } from "./prompts/baseSystemPrompt.js"
import { createSkillTool } from "./tools/skill.js"
import { TurnTracker } from "./summary/turnTracker.js"
import { InMemoryTurnSummaryStore } from "./summary/turnSummaryStore.js"
import { ContextSelector } from "./summary/contextSelector.js"
import { Summarizer } from "./summary/summarizer.js"
import type { TurnMeta, TurnChunk } from "./summary/types.js"
import { estimateTotalTokens } from "./utils/truncateMessages.js"

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
    /** Pre-loaded project instruction content. */
    projectInstructions?: string
    /** Summary config (experimental). Only from file config. */
    summary?: SummaryConfig
}

export type AgentEvent =
    | { type: "content"; delta: string }
    | { type: "reasoning"; delta: string }
    | { type: "reasoning_end" }
    | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
    | { type: "tool_result"; id: string; content: string; isError?: boolean }
    | { type: "done"; finishReason: string; usage?: TokenUsage }
    | { type: "context_compressed"; tokensBefore: number; tokensAfter: number }

/** Config needed to spawn a child Agent (no store/tools). */
export type AgentConfigSnapshot = Omit<AgentConfig, "store" | "tools">

export interface ContextBreakdown {
    systemTokens: number
    toolDefTokens: number
    messageTokens: number
    totalTokensUsed: number
    promptTokens: number
    completionTokens: number
    estimatedContextFree: number
    maxContextTokens: number
    messageCount: number
}

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

    private projectInstructions?: string

    // Summary runtime (experimental) — feature is active when turnTracker is defined
    private turnTracker?: TurnTracker
    private summaryStore?: InMemoryTurnSummaryStore
    private contextSelector?: ContextSelector
    private summarizer?: Summarizer

    /** Accumulated token usage across all turns in this session. */
    private totalUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

    /** Cached system prompt parts (loaded once at start of each run). */
    private cachedMemories?: string
    private cachedSubagentReminder?: string

    constructor(config: AgentConfig) {
        const { store, tools, mcpConfig, maxTurns, hooks, questionBridge, projectInstructions, ...snapshot } = config
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
        this.projectInstructions = projectInstructions
        if (!config.tools) {
            this.registerDelegationTool()
        }
        this.fileIndex = new FileIndexManager(config.cwd)
        this.fileIndex.build().catch((err) => {
            console.warn(`File index build failed, grep will use full scan: ${err.message}`)
        })

        // Initialize summary runtime if enabled
        if (config.summary?.enabled === true) {
            this.turnTracker = new TurnTracker()
            this.summaryStore = new InMemoryTurnSummaryStore()
            const summaryClient = this.createSummaryClient(config)
            this.contextSelector = new ContextSelector(summaryClient)
            this.summarizer = new Summarizer(summaryClient, this.summaryStore)
        }
    }

    private createSummaryClient(config: AgentConfig): LLMClient {
        return new LLMClient({
            provider: config.summary?.provider ?? config.provider,
            model: config.summary?.model ?? config.model,
            apiKey: config.summary?.apiKey ?? config.apiKey,
            baseURL: config.summary?.baseURL ?? config.baseURL,
            debug: config.debug,
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

    private buildSkillsPrompt(skills: Skill[]): string | undefined {
        return buildSkillsPromptSection(skills)
    }

    getMcpManager() {
        return this.tools.getMcpManager()
    }

    /** Snapshot current conversation history (for btw side-questions). */
    getStoreMessages(): CoreMessage[] {
        return this.store.getAll()
    }

    /** Get accumulated token usage for this session. */
    getTokenUsage(): TokenUsage {
        return { ...this.totalUsage }
    }

    /** Get context breakdown for /context command. */
    getContextInfo(): ContextBreakdown {
        const messages = this.store.getAll()
        const messageTokens = messages.reduce((s, m) => s + estimateTokens(m), 0)
        const toolDefs = this.tools.getToolDefinitions()
        const toolDefTokens = Math.ceil(JSON.stringify(toolDefs).length / CHARS_PER_TOKEN)
        const systemParts = [
            BASE_SYSTEM_PROMPT,
            this.projectInstructions,
            this.cachedMemories,
            this.cachedSubagentReminder,
            this.buildSkillsPrompt(this.skills),
        ].filter((p): p is string => Boolean(p && p.trim()))
        const systemTokens = Math.ceil(systemParts.join("\n\n").length / CHARS_PER_TOKEN)

        return {
            systemTokens,
            toolDefTokens,
            messageTokens,
            totalTokensUsed: this.totalUsage.totalTokens,
            promptTokens: this.totalUsage.promptTokens,
            completionTokens: this.totalUsage.completionTokens,
            estimatedContextFree: Math.max(0, DEFAULT_MAX_TOKENS - messageTokens - toolDefTokens - systemTokens),
            maxContextTokens: DEFAULT_MAX_TOKENS,
            messageCount: messages.length,
        }
    }

    async *run(userMessage: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        this.store.add({ role: "user", content: userMessage })
        this.turnTracker?.observe(this.store.getAll())

        const workingContext = !!this.turnTracker
            ? await this.buildInitialWorkingContext(userMessage, signal)
            : this.store.getAll()

        yield* this.runLoop(signal, workingContext, true)
    }

    /** Run with whatever is already in {@link store} (e.g. system + user seeded for subagents). */
    async *runSeeded(signal?: AbortSignal): AsyncGenerator<AgentEvent> {
        // runSeeded has no new user message — v1 always uses canonical history
        // and does not trigger summary enqueue (no new user turn semantics)
        yield* this.runLoop(signal, this.store.getAll(), false)
    }

    private async buildInitialWorkingContext(userMessage: string, signal?: AbortSignal): Promise<CoreMessage[]> {
        const allMessages = this.store.getAll()
        const turns = this.turnTracker!.getTurns()
        const summaries = this.summaryStore!.getAll()

        // Skip condition: small context, few turns
        const totalTokens = estimateTotalTokens(allMessages)
        if (totalTokens < DEFAULT_MAX_TOKENS * 0.3 && turns.length <= 3) {
            return allMessages
        }

        // Build TurnMeta[] by merging turn boundaries with summary state
        const turnMetaList: TurnMeta[] = turns.map(t => ({
            turnId: t.turnId,
            startMsgId: t.startMsgId,
            endMsgId: t.endMsgId,
            hasSummary: this.summaryStore!.get(t.turnId) !== undefined,
            isPending: this.summaryStore!.isPending(t.turnId),
            isFailed: this.summaryStore!.isFailed(t.turnId),
        }))

        // The latest turn (current user message) is always included full
        const latestTurnId = turns.length > 0 ? turns[turns.length - 1].turnId : undefined
        const skipSelection = summaries.length === 0 // no summaries yet, nothing to select from

        try {
            const result = await this.contextSelector!.select(
                userMessage,
                summaries,
                turnMetaList,
                { skipSelection, signal },
            )

            // Build assembled context
            const assembled: CoreMessage[] = []

            // 1. Summary prefix — format here so contextSelector stays format-agnostic
            if (result.allSummaries.length > 0) {
                const formatted = result.allSummaries.map(s => `### ${s.turnId}\n${s.summary}`).join("\n\n")
                assembled.push({
                    role: "user",
                    content: `[Context Summaries — per-turn summaries from earlier in the session]\n\n${formatted}`,
                })
                assembled.push({
                    role: "assistant",
                    content: "Understood. I have the context summaries and will continue from there.",
                })
            }

            // 2. Full original messages for selected turns (as turn chunks for pruning)
            const selectedTurnIds = new Set(result.fullTurns)
            const turnChunks: TurnChunk[] = []

            for (const turn of turns) {
                const isLatest = turn.turnId === latestTurnId
                const isSelected = selectedTurnIds.has(turn.turnId)
                const hasSummary = this.summaryStore!.get(turn.turnId) !== undefined
                const isPending = this.summaryStore!.isPending(turn.turnId)
                const isFailed = this.summaryStore!.isFailed(turn.turnId)

                // Force-keep turns that need fallback: pending, failed, or no summary yet
                const needsFallback = !hasSummary || isPending || isFailed
                if (!isSelected && !isLatest && !needsFallback) continue

                const turnMessages = this.turnTracker!.getMessagesForTurn(turn.turnId, allMessages)
                if (turnMessages.length === 0) continue

                turnChunks.push({
                    turnId: turn.turnId,
                    messages: turnMessages,
                    droppable: !isLatest && hasSummary && !isPending && !isFailed,
                })
            }

            // 3. Deterministic pruning: drop oldest droppable chunks if over budget
            const budget = Math.floor(DEFAULT_MAX_TOKENS * 0.8) // leave room for tool defs + system
            let assembledTokens = estimateTotalTokens(assembled)
                + turnChunks.reduce((sum, c) => sum + estimateTotalTokens(c.messages), 0)
            while (assembledTokens > budget && turnChunks.length > 0) {
                const droppableIdx = turnChunks.findIndex(c => c.droppable)
                if (droppableIdx === -1) break // nothing left to drop
                const removed = turnChunks.splice(droppableIdx, 1)[0]
                assembledTokens -= estimateTotalTokens(removed.messages)
            }

            // 4. Flatten remaining turn chunks into assembled context
            for (const chunk of turnChunks) {
                assembled.push(...chunk.messages)
            }

            // If no messages assembled (shouldn't happen), fallback
            if (assembled.length === 0) {
                return allMessages
            }

            return assembled
        } catch (error) {
            console.warn("[Agent] Context selection failed, falling back to full history:", error)
            return allMessages
        }
    }

    private enqueueCompletedTurn(): void {
        if (!this.turnTracker || !this.summarizer || !this.summaryStore) return

        const allMessages = this.store.getAll()
        this.turnTracker.observe(allMessages)
        const turns = this.turnTracker.getTurns()
        if (turns.length === 0) return

        const completedTurn = turns[turns.length - 1]
        const turnMessages = this.turnTracker.getMessagesForTurn(completedTurn.turnId, allMessages)
        if (turnMessages.length === 0) return

        this.summarizer.enqueue(completedTurn.turnId, turnMessages, completedTurn.startMsgId, completedTurn.endMsgId)
    }

    private async *runLoop(signal?: AbortSignal, workingContext?: CoreMessage[], allowSummaryEnqueue = false): AsyncGenerator<AgentEvent> {
        this.activeSignal = signal
        const toolDefs = this.tools.getToolDefinitions()
        const store = this.store

        // Build system prompt: base + instructions + memories + skills + subagent reminder
        // Cache memories and subagent reminder for reuse in getContextInfo
        this.cachedMemories = await loadMemories(this.cwd)
        this.cachedSubagentReminder = await this.buildSubagentReminder()
        const systemParts = [
            BASE_SYSTEM_PROMPT,
            this.projectInstructions,
            this.cachedMemories,
            this.cachedSubagentReminder,
            this.buildSkillsPrompt(this.skills),
        ].filter((part): part is string => Boolean(part && part.trim()))
        const systemPrompt = systemParts.length > 0 ? systemParts.join("\n\n") : undefined

        function isAborted(): boolean {
            return Boolean(signal?.aborted)
        }

        const persistAssistantStep = (
            assistantContent: string,
            toolCalls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>,
        ): CoreMessage | null => {
            if (!assistantContent && toolCalls.length === 0) return null

            let msg: CoreMessage
            if (toolCalls.length === 0) {
                msg = { role: "assistant", content: assistantContent } as CoreMessage
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
                msg = { role: "assistant", content: parts } as CoreMessage
            }

            store.add(msg)
            return msg
        }

        const compressionOpts: CompressionOptions = {}

        try {
            for (let turn = 0; turn < this.maxTurns; turn++) {
                if (isAborted()) {
                    yield { type: "done", finishReason: "interrupted" }
                    return
                }

                if (!!!this.turnTracker && shouldCompress(store.getAll(), compressionOpts)) {
                    const result = await compressContext(store, this.llm, signal)
                    if (result.status === "compressed") {
                        yield { type: "context_compressed", tokensBefore: result.tokensBefore!, tokensAfter: result.tokensAfter! }
                    } else if (result.status === "failed_empty" || result.status === "failed_inflated") {
                        compressionOpts.failedLastAttempt = true
                    }
                }

                const stream = this.llm.stream(
                    convertToolMessages(truncateMessages(workingContext ?? store.getAll())),
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
                        const msg = persistAssistantStep(assistantContent, toolCallsThisTurn)
                        if (msg) workingContext?.push(msg)
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
                        if (event.usage) {
                            this.totalUsage.promptTokens += event.usage.promptTokens
                            this.totalUsage.completionTokens += event.usage.completionTokens
                            this.totalUsage.totalTokens += event.usage.totalTokens
                        }
                    }
                }

                // Phase 2: persist assistant BEFORE tool results (correct message order)
                const assistantMsg = persistAssistantStep(assistantContent, toolCallsThisTurn)
                if (assistantMsg) workingContext?.push(assistantMsg)

                // Phase 3a: serial permission pre-checks (one prompt at a time)
                const permissionDecisions = new Map<string, boolean>()
                for (const call of pendingToolEvents) {
                    const tool = this.tools.get(call.name)
                    if (this.hooks.beforeToolExecute && tool) {
                        const decision = await this.hooks.beforeToolExecute(call, tool)
                        permissionDecisions.set(call.id, decision === "allow")
                    } else {
                        permissionDecisions.set(call.id, true)
                    }
                }

                if (isAborted()) {
                    yield { type: "done", finishReason: "interrupted" }
                    return
                }

                // Phase 3b: execute approved tools in parallel
                const results = await Promise.all(
                    pendingToolEvents.map(call =>
                        permissionDecisions.get(call.id)
                            ? this.executeTool(call)
                            : Promise.resolve({ content: "Permission denied.", isError: true as const })
                    )
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
                    const toolMsg: CoreMessage = {
                        role: "tool",
                        content: [{ type: "tool-result", toolCallId: call.id, toolName: call.name, result: result.content, isError: result.isError }],
                    } as CoreMessage
                    this.store.add(toolMsg)
                    workingContext?.push(toolMsg)
                }

                for (let i = 0; i < pendingToolEvents.length; i++) {
                    const call = pendingToolEvents[i]
                    const result = results[i]
                    yield { type: "tool_result", id: call.id, content: result.content, isError: result.isError }
                }

                if (pendingToolEvents.length === 0 || finishReason.startsWith("error")) {
                    if (finishReason === "stop" && allowSummaryEnqueue) {
                        this.enqueueCompletedTurn()
                    }
                    yield { type: "done", finishReason, usage: { ...this.totalUsage } }
                    return
                }
            }

            yield { type: "done", finishReason: "length", usage: this.totalUsage }
        } finally {
            this.activeSignal = undefined
        }
    }

    private async executeTool(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
        const tool = this.tools.get(call.name)

        if (!tool) {
            return { content: `Error: Unknown tool '${call.name}'`, isError: true }
        }

        // Permission check is done in the serial pre-check phase before this method is called.
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

    /** Reset all summary runtime state. Call when canonical history is externally mutated. */
    private resetSummaryRuntime(): void {
        this.summaryStore?.clear()
        this.turnTracker?.reset()
        this.summarizer?.abort()
    }

    /** Force context compression (skips threshold check). Used by /compress command. */
    async forceCompress(): Promise<{ status: string; tokensBefore?: number; tokensAfter?: number }> {
        const result = await compressContext(this.store, this.llm)
        if (result.status === "compressed") {
            this.resetSummaryRuntime()
        }
        return result
    }

    clearHistory(): void {
        this.store.clear()
        this.resetSummaryRuntime()
    }

    replaceStore(newStore: MessageStore): void {
        this.store = newStore
        this.resetSummaryRuntime()
    }
}

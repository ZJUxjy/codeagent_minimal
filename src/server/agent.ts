// src/server/agent.ts
import type { CoreMessage } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry, type ToolRegistryOptions } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"
import type { LopConfig } from "../protocol/types.js"

/** Agent 配置 */
export interface AgentConfig {
  provider: "openai" | "anthropic" | "openrouter" | "minimax"
  model: string
  cwd: string
  apiKey?: string
  baseURL?: string
  debug?: boolean
  store?: MessageStore
  hooks?: AgentHooks
  mcpConfig?: Pick<LopConfig, "mcpServers" | "mcp">
}

/** Agent 输出事件 */
export type AgentEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning_end" }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "done"; finishReason: string }

/** Agent 核心 */
export class Agent {
  private llm: LLMClient
  private tools: ToolRegistry
  private store: MessageStore
  private hooks: AgentHooks
  private cwd: string

  constructor(config: AgentConfig) {
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
    this.tools = new ToolRegistry(registryOptions)
    this.store = config.store ?? new InMemoryStore()
    this.hooks = config.hooks ?? noopHooks
    this.cwd = config.cwd
  }

  /**
   * Discover MCP tools from configured servers
   */
  async discoverMcpTools(): Promise<void> {
    await this.tools.discoverMcpTools()
  }

  /**
   * Get MCP manager for status/reload operations
   */
  getMcpManager() {
    return this.tools.getMcpManager()
  }

  /**
   * 运行 Agent
   * @param userMessage 用户输入
   * @yields AgentEvent 流式事件
   */
  async *run(userMessage: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    this.store.add({ role: "user", content: userMessage })

    const messages = this.store.getAll()
    const toolDefs = this.tools.getToolDefinitions()
    const stream = this.llm.stream(messages, toolDefs)

    let assistantContent = ""
    const store = this.store

    function checkAborted(): boolean {
      if (signal?.aborted) {
        if (assistantContent) {
          store.add({ role: "assistant", content: assistantContent })
        }
        return true
      }
      return false
    }

    for await (const event of stream) {
      if (checkAborted()) {
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
        if (checkAborted()) {
          yield { type: "done", finishReason: "interrupted" }
          return
        }
        yield { type: "tool_call", id: event.id, name: event.name, args: event.args }
        const result = await this.executeTool(event)
        yield { type: "tool_result", id: event.id, content: result.content, isError: result.isError }

      } else if (event.type === "done") {
        if (assistantContent) {
          this.store.add({ role: "assistant", content: assistantContent })
        }
        yield { type: "done", finishReason: event.finishReason }
      }
    }
  }

  /** 执行单个工具 */
  private async executeTool(call: ToolCall): Promise<{ content: string; isError?: boolean }> {
    const tool = this.tools.get(call.name)

    if (!tool) {
      return { content: `Error: Unknown tool '${call.name}'`, isError: true }
    }

    if (this.hooks.beforeToolExecute) {
      const decision = await this.hooks.beforeToolExecute(call, tool)
      if (decision === "deny") {
        return { content: `Error: Tool execution denied by policy`, isError: true }
      }
      // TODO: handle "ask" decision (requires client interaction)
    }

    const ctx: ToolContext = { cwd: this.cwd }

    try {
      const content = await tool.execute(call.args as any, ctx)
      return { content }
    } catch (error: any) {
      return { content: `Error: ${error.message}`, isError: true }
    }
  }

  /** 清空对话历史 */
  clearHistory(): void {
    this.store.clear()
  }
}

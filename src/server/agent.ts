// src/server/agent.ts
import type { CoreMessage } from "ai"
import { LLMClient } from "../llm.js"
import { ToolRegistry } from "./tools/index.js"
import { InMemoryStore, type MessageStore } from "./store.js"
import { noopHooks, type AgentHooks, type ToolCall } from "./hooks/types.js"
import type { ToolContext } from "./tools/types.js"

/** Agent 配置 */
export interface AgentConfig {
  provider: "openai" | "anthropic" | "openrouter"
  model: string
  cwd: string
  store?: MessageStore
  hooks?: AgentHooks
}

/** Agent 输出事件 */
export type AgentEvent =
  | { type: "content"; delta: string }
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
    })
    this.tools = new ToolRegistry()
    this.store = config.store ?? new InMemoryStore()
    this.hooks = config.hooks ?? noopHooks
    this.cwd = config.cwd
  }

  /**
   * 运行 Agent
   * @param userMessage 用户输入
   * @yields AgentEvent 流式事件
   */
  async *run(userMessage: string): AsyncGenerator<AgentEvent> {
    // 1. 添加用户消息到历史
    this.store.add({ role: "user", content: userMessage })

    // 2. 获取当前消息历史
    const messages = this.store.getAll()

    // 3. 获取工具定义
    const toolDefs = this.tools.getToolDefinitions()

    // 4. 调用 LLM 流式
    const stream = this.llm.stream(messages, toolDefs)

    let assistantContent = ""

    for await (const event of stream) {
      if (event.type === "content") {
        // 文本增量
        assistantContent += event.delta
        yield { type: "content", delta: event.delta }

      } else if (event.type === "tool_call") {
        // 工具调用
        yield { type: "tool_call", id: event.id, name: event.name, args: event.args }

        // 执行工具
        const result = await this.executeTool(event)
        yield { type: "tool_result", id: event.id, content: result.content, isError: result.isError }

      } else if (event.type === "done") {
        // 保存 assistant 消息
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

  /** 清空对话历史 */
  clearHistory(): void {
    this.store.clear()
  }
}

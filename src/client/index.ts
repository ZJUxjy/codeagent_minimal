// src/client/index.ts
import { spawn, type ChildProcess } from "child_process"
import * as readline from "readline"
import type { JsonRpcRequest, JsonRpcNotification, LopConfig } from "../protocol/types.js"
import { debugLog } from "../config.js"
import { getGlobalLogger } from "../utils/logger.js"

/** TUI 主题，与 `src/tui/themes` 中 ThemeId 一致 */
export type TuiThemeId = "dark" | "light" | "ansi"

export interface ClientOptions {
  cwd?: string
  provider?: string
  model?: string
  apiKey?: string
  baseURL?: string
  debug?: boolean
  /** 终端 UI 主题；也可设置环境变量 LOP_THEME */
  theme?: TuiThemeId
  /** MCP server 配置 */
  mcpServers?: LopConfig["mcpServers"]
  mcp?: LopConfig["mcp"]
}

export type ClientEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning_end" }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "done"; finishReason: string }

export class Client {
  private server: ChildProcess
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>()
  private eventHandler?: (event: ClientEvent) => void
  private debug: boolean

  constructor(options: ClientOptions = {}) {
    this.debug = options.debug ?? false
    const env: Record<string, string> = {}
    if (options.provider) env.LOP_PROVIDER = options.provider
    if (options.model) env.LOP_MODEL = options.model
    if (options.apiKey) env.LOP_API_KEY = options.apiKey
    if (options.baseURL) env.LOP_BASE_URL = options.baseURL
    if (this.debug) env.LOP_DEBUG = "true"
    if (options.mcpServers) env.LOP_MCP_SERVERS = JSON.stringify(options.mcpServers)
    if (options.mcp) env.LOP_MCP = JSON.stringify(options.mcp)

    // 调试日志
    if (this.debug) {
      if (options.apiKey) {
        console.error(`[Debug] Passing API Key: ${options.apiKey.slice(0, 10)}...`)
      }
      if (options.baseURL) {
        console.error(`[Debug] Passing Base URL: ${options.baseURL}`)
      }
    }

    this.server = spawn("node", ["dist/server/index.js"], {
      stdio: ["pipe", "pipe", "inherit"],
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...env },
    })

    // 处理 server 输出
    const rl = readline.createInterface({
      input: this.server.stdout!,
      terminal: false,
    })

    rl.on("line", (line) => {
      getGlobalLogger().info('server', line)
      try {
        this.handleMessage(JSON.parse(line))
      } catch (error) {
        console.error("Failed to parse server message:", error)
      }
    })

    this.server.on("error", (error) => {
      console.error("Server error:", error)
    })
  }

  private handleMessage(message: any): void {
    if (message.method) {
      // 通知
      this.handleNotification(message as JsonRpcNotification)
    } else if (message.id !== undefined) {
      // 响应
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        this.pendingRequests.delete(message.id)
        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
    }
  }

  private handleNotification(notification: JsonRpcNotification): void {
    if (!this.eventHandler) return

    const { method, params } = notification
    const p = params as Record<string, any>

    switch (method) {
      case "content":
        this.eventHandler({ type: "content", delta: p.delta })
        break
      case "reasoning":
        this.eventHandler({ type: "reasoning", delta: p.delta })
        break
      case "reasoning_end":
        this.eventHandler({ type: "reasoning_end" })
        break
      case "tool_call":
        this.eventHandler({ type: "tool_call", id: p.id, name: p.name, args: p.args })
        break
      case "tool_result":
        this.eventHandler({ type: "tool_result", id: p.id, content: p.content, isError: p.isError })
        break
      case "done":
        this.eventHandler({ type: "done", finishReason: p.finishReason })
        break
      default:
        console.warn(`Unknown notification method: ${method}`)
    }
  }

  private sendRequest<T>(method: string, params?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId
      const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }

      this.pendingRequests.set(id, { resolve, reject })
      this.server.stdin!.write(JSON.stringify(request) + "\n")
    })
  }

  /** 初始化连接 */
  async initialize(): Promise<void> {
    await this.sendRequest("initialize", {
      clientInfo: { name: "lop_minimal_cli", version: "0.1.0" },
    })
  }

  /** 设置事件处理器 */
  onEvent(handler: (event: ClientEvent) => void): void {
    this.eventHandler = handler
  }

  /** 发送聊天消息 */
  async chat(message: string, cwd?: string): Promise<void> {
    await this.sendRequest("chat", { message, cwd })
  }

  /** Interrupt the current execution */
  async interrupt(): Promise<void> {
    await this.sendRequest("interrupt")
  }

  /** 清空对话历史 */
  async clear(): Promise<void> {
    await this.sendRequest("clear")
  }

  /** List MCP server status */
  async mcpList(): Promise<{ servers: Array<{ name: string; status: string; error?: string }> }> {
    return this.sendRequest("mcp_list")
  }

  /** Reload MCP tools */
  async mcpReload(): Promise<{ servers: Array<{ name: string; status: string; error?: string }>; reloaded: boolean }> {
    return this.sendRequest("mcp_reload")
  }

  /** 加载历史会话（替换当前 Agent store） */
  async loadSession(sessionId: string): Promise<{ sessionId: string; messageCount: number }> {
    return this.sendRequest('load_session', { sessionId })
  }

  /** 关闭客户端 */
  close(): void {
    this.server.kill()
  }
}

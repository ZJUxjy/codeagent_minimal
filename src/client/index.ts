// src/client/index.ts
import { spawn, type ChildProcess } from "child_process"
import * as readline from "readline"
import type { JsonRpcRequest, JsonRpcNotification, LopConfig, Question, PermissionOutcome } from "../protocol/types.js"
import { debugLog } from "../config.js"
import { getGlobalLogger } from "../utils/logger.js"
import { getErrorMessage } from "../utils/error.js"

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
  /** 启动时自动恢复最近会话 */
  resume?: boolean
  /** 会话持久化配置 */
  persistence?: { enabled?: boolean }
  /** 技能路径配置 */
  skills?: LopConfig["skills"]
  /** 权限审批模式 */
  approvalMode?: LopConfig["approvalMode"]
}

export type ClientEvent =
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reasoning_end" }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; content: string; isError?: boolean }
  | { type: "done"; finishReason: string }
  | { type: "ask_question"; requestId: string; questions: Question[] }
  | { type: "permission_request"; requestId: string; toolName: string; summary: string }

export class Client {
  private server: ChildProcess
  private requestId = 0
  private pendingRequests = new Map<number, { resolve: Function; reject: Function }>()
  private eventHandler?: (event: ClientEvent) => void
  private debug: boolean
  private currentSessionId: string | null = null

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
    if (options.persistence) env.LOP_PERSISTENCE = JSON.stringify(options.persistence)
    if (options.skills?.paths && options.skills.paths.length > 0) {
      env.LOP_SKILLS_PATHS = options.skills.paths.join(",")
    }
    if (options.approvalMode) env.LOP_APPROVAL_MODE = options.approvalMode

    if (this.debug) {
      if (options.apiKey) {
        getGlobalLogger().debug('client', `Passing API Key: ${options.apiKey.slice(0, 10)}...`)
      }
      if (options.baseURL) {
        getGlobalLogger().debug('client', `Passing Base URL: ${options.baseURL}`)
      }
    }

    // When running under tsx (dev/debug), spawn server with tsx so TS breakpoints work.
    const useTsx = !!(process.env.TSX_TSCONFIG_PATH || process.argv[1]?.includes('tsx'))
    const serverArgs: string[] = useTsx
      ? ["--import", "tsx", "src/server/index.ts"]
      : ["dist/server/index.js"]

    // Expose inspector when VSCODE_INSPECTOR_OPTIONS is set (VS Code debugging)
    if (process.env.VSCODE_INSPECTOR_OPTIONS) {
      serverArgs.unshift("--inspect=9229")
    }

    this.server = spawn("node", serverArgs, {
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
        getGlobalLogger().error('client', 'Failed to parse server message:', getErrorMessage(error))
      }
    })

    this.server.on("error", (error) => {
      getGlobalLogger().error('server', 'Server error:', getErrorMessage(error))
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
      case "ask_question":
        this.eventHandler({
          type: "ask_question",
          requestId: p.requestId,
          questions: p.questions,
        })
        break
      case "permission_request":
        this.eventHandler({
          type: "permission_request",
          requestId: p.requestId,
          toolName: p.toolName,
          summary: p.summary,
        })
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
  async initialize(): Promise<{ sessionId: string | null }> {
    const result = await this.sendRequest<{ sessionId: string | null }>("initialize", {
      clientInfo: { name: "lop_minimal_cli", version: "0.1.0" },
    })
    this.currentSessionId = result.sessionId ?? null
    return result
  }

  getSessionId(): string | null {
    return this.currentSessionId
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

  /** Respond to a permission prompt */
  async respondToPermission(requestId: string, outcome: PermissionOutcome): Promise<void> {
    await this.sendRequest("permission_response", { requestId, outcome })
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

  /** Respond to an ask_question notification */
  async respondToQuestion(requestId: string, answers?: Record<string, string>, cancelled?: boolean): Promise<void> {
    await this.sendRequest("ask_question_response", { requestId, answers, cancelled })
  }

  /** Change approval mode at runtime */
  async setApprovalMode(mode: "default" | "cautious" | "yolo"): Promise<void> {
    await this.sendRequest("set_approval_mode", { mode })
  }

  /** 加载历史会话（替换当前 Agent store） */
  async loadSession(sessionId: string): Promise<{ sessionId: string; messageCount: number }> {
    return this.sendRequest('load_session', { sessionId })
  }

  /** 删除历史会话 */
  async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
    return this.sendRequest('delete_session', { sessionId })
  }

  /** 重命名会话（设置标题） */
  async renameSession(sessionId: string, title: string): Promise<{ sessionId: string; title: string }> {
    return this.sendRequest('rename_session', { sessionId, title })
  }

  /** Get currently loaded instruction files */
  async getInstructions(): Promise<{
    files: Array<{ path: string; size: number; sizeFormatted: string }>
    totalSize: number
    totalSizeFormatted: string
  }> {
    return this.sendRequest("get_instructions")
  }

  /** 关闭客户端 */
  close(): void {
    this.server.kill()
  }
}

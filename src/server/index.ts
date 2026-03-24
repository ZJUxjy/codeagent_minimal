// src/server/index.ts
import * as readline from "readline"
import { Agent, type AgentConfig, type AgentEvent } from "./agent.js"
import type { JsonRpcRequest, JsonRpcNotification } from "../protocol/types.js"

let agent: Agent | null = null
let currentCwd = process.cwd()
let debugEnabled = process.env.LOP_DEBUG === "true"
let currentAbortController: AbortController | null = null

/** 调试日志 */
function debugLog(...args: unknown[]): void {
    if (debugEnabled) {
        console.error("[Server]", ...args)
    }
}

/** 发送 JSON-RPC 通知 */
function sendNotification(method: string, params: unknown): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", method, params }))
}

/** 发送 JSON-RPC 响应 */
function sendResponse(id: number | string, result: unknown): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
}

/** 发送 JSON-RPC 错误 */
function sendError(id: number | string, code: number, message: string): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }))
}

/** 处理 JSON-RPC 请求 */
async function handleRequest(request: JsonRpcRequest): Promise<void> {
    const { method, params, id } = request
    const requestId = id ?? 0

    switch (method) {
        case "initialize": {
            const config: AgentConfig = {
                provider: (process.env.LOP_PROVIDER as AgentConfig["provider"]) ?? "openai",
                model: process.env.LOP_MODEL ?? "gpt-4o",
                apiKey: process.env.LOP_API_KEY,
                baseURL: process.env.LOP_BASE_URL,
                cwd: currentCwd,
                debug: debugEnabled,
            }

            debugLog(`Config: provider=${config.provider}, model=${config.model}`)
            debugLog(`API Key: ${config.apiKey?.slice(0, 10)}...`)
            debugLog(`Base URL: ${config.baseURL}`)

            agent = new Agent(config)

            sendResponse(requestId, {
                serverInfo: {
                    name: "lop_minimal_server",
                    version: "0.1.0",
                },
                capabilities: {},
            })
            break
        }

        case "chat": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }

            const { message, cwd } = params as { message: string; cwd?: string }

            // 如果 cwd 变化，重新创建 Agent
            if (cwd && cwd !== currentCwd) {
                currentCwd = cwd
                const config: AgentConfig = {
                    provider: (process.env.LOP_PROVIDER as AgentConfig["provider"]) ?? "openai",
                    model: process.env.LOP_MODEL ?? "gpt-4o",
                    cwd: currentCwd,
                }
                agent = new Agent(config)
            }

            try {
                currentAbortController = new AbortController()
                for await (const event of agent.run(message, currentAbortController.signal)) {
                    switch (event.type) {
                        case "content":
                            sendNotification("content", { delta: event.delta })
                            break
                        case "tool_call":
                            sendNotification("tool_call", {
                                id: event.id,
                                name: event.name,
                                args: event.args,
                            })
                            break
                        case "tool_result":
                            sendNotification("tool_result", {
                                id: event.id,
                                result: event.content,
                                isError: event.isError
                            })
                            break
                        case "done":
                            sendNotification("done", { finishReason: event.finishReason })
                            break
                    }
                }
                sendResponse(requestId, {})
            } catch (error: any) {
                sendError(requestId, -32000, error.message)
            } finally {
                currentAbortController = null
            }
            break
        }

        case "interrupt": {
            if (currentAbortController) {
                currentAbortController.abort()
            }
            sendResponse(requestId, {})
            break
        }

        case "clear": {
            if (agent) {
                agent.clearHistory()
            }
            sendResponse(requestId, {})
            break
        }

        case "mcp_list": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }

            const manager = agent.getMcpManager()
            if (!manager) {
                sendResponse(requestId, { servers: [] })
                return
            }

            const status = manager.getStatus()
            sendResponse(requestId, { servers: status })
            break
        }

        case "mcp_reload": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }

            try {
                await agent.discoverMcpTools()
                const manager = agent.getMcpManager()
                const status = manager?.getStatus() ?? []
                sendResponse(requestId, { servers: status, reloaded: true })
            } catch (error: any) {
                sendError(requestId, -32000, error.message)
            }
            break
        }

        default:
            sendError(requestId, -32601, `Method not found: ${method}`)
    }
}

const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
})

rl.on("line", (line) => {
    try {
        const request = JSON.parse(line) as JsonRpcRequest
        handleRequest(request).catch((error) => {
            sendError(request.id ?? 0, -32000, error.message)
        })
    } catch {
        sendError(0, -32700, "Parse error")
    }
})

// 保持进程运行
process.stdin.resume()

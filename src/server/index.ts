// src/server/index.ts
import * as readline from "readline"
import { Agent, type AgentConfig, type AgentEvent } from "./agent.js"
import type { JsonRpcRequest, JsonRpcNotification } from "../protocol/types.js"
import { debugLog } from "../config.js"
import { FileStore } from "./stores/FileStore.js"
import type { MessageStore } from "./store.js"
import { QuestionBridge } from "./questionBridge.js"
import { AskQuestionResponseParamsSchema } from "../protocol/types.js"

let agent: Agent | null = null
let currentCwd = process.cwd()
let currentAbortController: AbortController | null = null
let questionBridge: QuestionBridge | null = null

function getMcpConfigFromEnv(): AgentConfig["mcpConfig"] {
    const config: AgentConfig["mcpConfig"] = {}

    if (process.env.LOP_MCP_SERVERS) {
        try {
            config.mcpServers = JSON.parse(process.env.LOP_MCP_SERVERS)
        } catch {
            console.error("Failed to parse LOP_MCP_SERVERS")
        }
    }

    if (process.env.LOP_MCP) {
        try {
            config.mcp = JSON.parse(process.env.LOP_MCP)
        } catch {
            console.error("Failed to parse LOP_MCP")
        }
    }

    return config
}

function buildServerAgentConfig(cwd: string, store?: MessageStore): AgentConfig {
    return {
        provider: (process.env.LOP_PROVIDER as AgentConfig["provider"]) ?? "openai",
        model: process.env.LOP_MODEL ?? "gpt-4o",
        apiKey: process.env.LOP_API_KEY,
        baseURL: process.env.LOP_BASE_URL,
        cwd,
        debug: process.env.LOP_DEBUG === "true",
        mcpConfig: getMcpConfigFromEnv(),
        ...(store ? { store } : {}),
    }
}

function sendNotification(method: string, params: unknown): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", method, params }))
}

function sendResponse(id: number | string, result: unknown): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, result }))
}

function sendError(id: number | string, code: number, message: string): void {
    console.log(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }))
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
    const { method, params, id } = request
    const requestId = id ?? 0

    switch (method) {
        case "initialize": {
            let store: MessageStore | undefined
            if (process.env.LOP_PERSISTENCE === "true") {
                store = FileStore.createSession(currentCwd)
                debugLog("server", `Persistence enabled, session: ${(store as FileStore).getSessionId()}`)
            }
            const config = buildServerAgentConfig(currentCwd, store)

            debugLog("server", `Config: provider=${config.provider}, model=${config.model}`)
            debugLog("server", `API Key: ${config.apiKey?.slice(0, 10)}...`)
            debugLog("server", `Base URL: ${config.baseURL}`)

            questionBridge = new QuestionBridge(sendNotification)
            agent = new Agent({ ...config, questionBridge })

            if (config.mcpConfig?.mcpServers && Object.keys(config.mcpConfig.mcpServers).length > 0) {
                agent.discoverMcpTools().catch((err) => {
                    debugLog("server", "MCP discovery failed:", err)
                })
            }

            sendResponse(requestId, {
                serverInfo: { name: "lop_minimal_server", version: "0.1.0" },
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
                const config = buildServerAgentConfig(currentCwd)
                agent = new Agent({ ...config, questionBridge: questionBridge! })
                if (config.mcpConfig?.mcpServers && Object.keys(config.mcpConfig.mcpServers).length > 0) {
                    agent.discoverMcpTools().catch((err) => {
                        debugLog("server", "MCP discovery failed:", err)
                    })
                }
            }

            try {
                currentAbortController = new AbortController()
                for await (const event of agent.run(message, currentAbortController.signal)) {
                    switch (event.type) {
                        case "content":
                            sendNotification("content", { delta: event.delta })
                            break
                        case "reasoning":
                            sendNotification("reasoning", { delta: event.delta })
                            break
                        case "reasoning_end":
                            sendNotification("reasoning_end", {})
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
                                content: event.content,
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
            if (questionBridge) {
                questionBridge.cancelAll()
            }
            sendResponse(requestId, {})
            break
        }

        case "ask_question_response": {
            const parseResult = AskQuestionResponseParamsSchema.safeParse(params)
            if (!parseResult.success) {
                sendError(requestId, -32602, "Invalid params")
                return
            }
            if (questionBridge) {
                questionBridge.handleResponse(parseResult.data)
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

        case "load_session": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }
            const { sessionId } = params as { sessionId: string }
            if (!sessionId) {
                sendError(requestId, -32602, "sessionId is required")
                return
            }
            const loadedStore = FileStore.loadSession(sessionId, currentCwd)
            if (loadedStore.getMessageCount() === 0) {
                sendError(requestId, -32001, `Session not found or empty: ${sessionId}`)
                return
            }
            agent.replaceStore(loadedStore)
            sendResponse(requestId, { sessionId, messageCount: loadedStore.getMessageCount() })
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

process.stdin.resume()

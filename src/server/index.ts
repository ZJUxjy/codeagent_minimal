// src/server/index.ts
import * as readline from "readline"
import type { CoreMessage } from "ai"
import { Agent, type AgentConfig, type AgentEvent } from "./agent.js"
import type { JsonRpcRequest, JsonRpcNotification, LopConfig } from "../protocol/types.js"
import { debugLog } from "../config.js"
import { FileStore } from "./stores/FileStore.js"
import { cleanupOldSessions } from "./stores/sessionCleanup.js"
import { SessionIndex } from "./stores/SessionIndex.js"
import { getSessionDir } from "./utils/storagePath.js"
import type { MessageStore } from "./store.js"
import { QuestionBridge } from "./questionBridge.js"
import { AskQuestionResponseParamsSchema, PermissionResponseParamsSchema } from "../protocol/types.js"
import { PermissionEngine, type ApprovalMode } from "./security/permissionEngine.js"
import { createPermissionHook } from "./security/permissionHook.js"
import { loadSkills } from "./skills/index.js"
import { SkillWatcher } from "./skills/watcher.js"
import { loadProjectInstructions, discoverInstructionFiles, formatInstructionPath, formatInstructionSize } from "./instructions/index.js"
import { LLMClient } from "../llm.js"
import { convertToolMessages, truncateMessages } from "./utils/truncateMessages.js"

let agent: Agent | null = null
let currentCwd = process.cwd()
let currentAbortController: AbortController | null = null
let btwAbortController: AbortController | null = null
let btwRequestId: number | string | null = null
let questionBridge: QuestionBridge | null = null
let permissionEngine: PermissionEngine | null = null
let skillWatcher: SkillWatcher | undefined

function getApprovalMode(): ApprovalMode {
    const raw = process.env.LOP_APPROVAL_MODE
    if (raw === "yolo" || raw === "cautious") return raw
    return "default"
}

function isPersistenceEnabled(): boolean {
    const env = process.env.LOP_PERSISTENCE
    if (env === 'false' || env === '0') return false
    if (env) {
        try {
            const parsed = JSON.parse(env)
            return parsed.enabled !== false
        } catch {}
    }
    return true  // default on
}

function getPersistenceConfig(): { maxAgeMs?: number; maxCount?: number } {
    const env = process.env.LOP_PERSISTENCE
    if (!env) return {}
    try {
        const parsed = JSON.parse(env)
        return {
            maxAgeMs: parsed.maxAgeDays != null ? parsed.maxAgeDays * 24 * 60 * 60 * 1000 : undefined,
            maxCount: parsed.maxSessions,
        }
    } catch {
        return {}
    }
}

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
            if (isPersistenceEnabled()) {
                store = FileStore.createSession(currentCwd)
                debugLog("server", `Persistence enabled, session: ${(store as FileStore).getSessionId()}`)
            }
            const config = buildServerAgentConfig(currentCwd, store)
            if (store) {
                (store as FileStore).setMeta(config.provider, config.model)
                // Fire-and-forget cleanup of old sessions
                try {
                    const deleted = cleanupOldSessions(currentCwd, getPersistenceConfig())
                    if (deleted > 0) debugLog("server", `Cleaned up ${deleted} old session(s)`)
                } catch (e) {
                    debugLog("server", "Session cleanup failed:", e)
                }
            }

            debugLog("server", `Config: provider=${config.provider}, model=${config.model}`)
            debugLog("server", `API Key: ${config.apiKey?.slice(0, 10)}...`)
            debugLog("server", `Base URL: ${config.baseURL}`)

            const [skillResult, projectInstructions] = await Promise.all([
                loadSkills(currentCwd),
                loadProjectInstructions(currentCwd),
            ])
            for (const diagnostic of skillResult.diagnostics) {
                debugLog("skills", diagnostic)
            }

            questionBridge = new QuestionBridge(sendNotification)
            permissionEngine = new PermissionEngine(getApprovalMode(), currentCwd)
            const permissionHook = createPermissionHook(permissionEngine, questionBridge)
            agent = new Agent({
                ...config,
                skills: skillResult.skills,
                projectInstructions,
                questionBridge,
                hooks: { beforeToolExecute: permissionHook },
            })

            if (config.mcpConfig?.mcpServers && Object.keys(config.mcpConfig.mcpServers).length > 0) {
                agent.discoverMcpTools().catch((err) => {
                    debugLog("server", "MCP discovery failed:", err)
                })
            }

            // Start skill file watcher for hot-reload
            skillWatcher = new SkillWatcher(currentCwd)
            skillWatcher.start({
                onReload: async (result) => {
                    for (const d of result.diagnostics) debugLog("skills", d)
                    if (agent) {
                        agent.updateSkills(result.skills)
                    }
                },
                onError: (err) => debugLog("skills", "Watcher error:", err.message),
            })

            sendResponse(requestId, {
                serverInfo: { name: "lop_minimal_server", version: "0.1.0" },
                capabilities: {},
                sessionId: store ? (store as FileStore).getSessionId() : null,
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
                const [skillResult, projectInstructions] = await Promise.all([
                    loadSkills(currentCwd),
                    loadProjectInstructions(currentCwd),
                ])
                for (const diagnostic of skillResult.diagnostics) {
                    debugLog("skills", diagnostic)
                }
                permissionEngine = new PermissionEngine(getApprovalMode(), currentCwd)
                const permHook = createPermissionHook(permissionEngine, questionBridge!)
                agent = new Agent({
                    ...config,
                    skills: skillResult.skills,
                    projectInstructions,
                    questionBridge: questionBridge!,
                    hooks: { beforeToolExecute: permHook },
                })
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
                            sendNotification("done", {
                                finishReason: event.finishReason,
                                usage: event.usage,
                            })
                            break
                        case "context_compressed":
                            sendNotification("context_compressed", { tokensBefore: event.tokensBefore, tokensAfter: event.tokensAfter })
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

        case "permission_response": {
            const parseResult = PermissionResponseParamsSchema.safeParse(params)
            if (!parseResult.success) {
                sendError(requestId, -32602, "Invalid params")
                return
            }
            const handled = questionBridge?.handlePermissionResponse(parseResult.data) ?? false
            if (!handled) {
                sendError(requestId, -32004, "Unknown or expired permission requestId")
                return
            }
            sendResponse(requestId, {})
            break
        }

        case "set_approval_mode": {
            const { mode } = params as { mode: "default" | "cautious" | "yolo" }
            if (permissionEngine) {
                permissionEngine.setApprovalMode(mode)
                debugLog("permission", `Approval mode set to: ${mode}`)
            }
            sendResponse(requestId, { mode })
            break
        }

        case "ask_question_response": {
            const parseResult = AskQuestionResponseParamsSchema.safeParse(params)
            if (!parseResult.success) {
                sendError(requestId, -32602, "Invalid params")
                return
            }
            const handled = questionBridge?.handleResponse(parseResult.data) ?? false
            if (!handled) {
                sendError(requestId, -32004, "Unknown or expired ask_question requestId")
                return
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

        case "delete_session": {
            const { sessionId } = params as { sessionId: string }
            if (!sessionId) {
                sendError(requestId, -32602, "sessionId is required")
                return
            }
            const deleted = FileStore.deleteSession(sessionId, currentCwd)
            if (!deleted) {
                sendError(requestId, -32001, `Session not found: ${sessionId}`)
                return
            }
            sendResponse(requestId, { deleted: true })
            break
        }

        case "rename_session": {
            const { sessionId, title } = params as { sessionId: string; title: string }
            if (!sessionId || !title) {
                sendError(requestId, -32602, "sessionId and title are required")
                return
            }
            const dir = getSessionDir(currentCwd)
            const idx = new SessionIndex(dir)
            const existing = idx.getSession(sessionId)
            if (!existing) {
                sendError(requestId, -32001, `Session not found: ${sessionId}`)
                return
            }
            idx.updateSession(sessionId, { title })
            sendResponse(requestId, { sessionId, title })
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

        case "compress": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }
            const result = await agent.forceCompress()
            sendResponse(requestId, result)
            break
        }

        case "get_instructions": {
            const files = await discoverInstructionFiles(currentCwd)
            const totalSize = files.reduce((sum, f) => sum + f.size, 0)
            sendResponse(requestId, {
                files: files.map((f) => ({
                    path: formatInstructionPath(f.path),
                    size: f.size,
                    sizeFormatted: formatInstructionSize(f.size),
                })),
                totalSize,
                totalSizeFormatted: formatInstructionSize(totalSize),
            })
            break
        }

        case "context_info": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }
            sendResponse(requestId, agent.getContextInfo())
            break
        }

        case "btw": {
            if (!agent) {
                sendError(requestId, -32002, "Not initialized")
                return
            }

            const { message } = params as { message: string }
            if (!message?.trim()) {
                sendError(requestId, -32602, "message is required")
                return
            }

            // Cancel any in-flight btw and resolve its pending request
            if (btwAbortController) {
                btwAbortController.abort()
                if (btwRequestId !== null) sendResponse(btwRequestId, {})
            }
            btwAbortController = new AbortController()
            btwRequestId = requestId
            const btwController = btwAbortController
            const btwSignal = btwController.signal

            // Snapshot conversation history
            const history = agent.getStoreMessages()
            const snapshot = agent.getConfigSnapshot()
            const convertedHistory = convertToolMessages(truncateMessages(history))

            const llm = new LLMClient({
                provider: snapshot.provider,
                model: snapshot.model,
                apiKey: snapshot.apiKey,
                baseURL: snapshot.baseURL,
                debug: snapshot.debug,
            })

            // Frame as side question
            const framedMessages: CoreMessage[] = [
                ...convertedHistory,
                { role: "user", content: `[Side question — answer briefly and concisely. This is a "by the way" question that should not be part of the main conversation.]\n\n${message}` },
            ]

            // Fire-and-forget streaming
            ;(async () => {
                try {
                    const stream = llm.stream(framedMessages, {}, undefined)
                    for await (const event of stream) {
                        if (btwSignal.aborted) return
                        if (event.type === "content") {
                            sendNotification("btw_content", { delta: event.delta })
                        } else if (event.type === "done") {
                            sendNotification("btw_done", { finishReason: event.finishReason })
                        }
                    }
                } catch (error: any) {
                    if (!btwSignal.aborted) {
                        sendNotification("btw_done", { finishReason: `error: ${error.message}` })
                    }
                }
                sendResponse(requestId, {})
                if (btwAbortController === btwController) {
                    btwAbortController = null
                    btwRequestId = null
                }
            })()
            break
        }

        case "interrupt_btw": {
            if (btwAbortController) {
                btwAbortController.abort()
                btwAbortController = null
                // Resolve the pending btw request so client doesn't hang
                if (btwRequestId !== null) {
                    sendResponse(btwRequestId, {})
                    btwRequestId = null
                }
            }
            sendResponse(requestId, {})
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

function cleanup(): void {
    skillWatcher?.stop().catch(() => {})
}
process.on("SIGTERM", cleanup)
process.on("SIGINT", cleanup)

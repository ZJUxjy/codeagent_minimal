import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "child_process"
import * as readline from "readline"
import { resolve } from "path"

interface JsonRpcRequest {
    jsonrpc: "2.0"
    id: number
    method: string
    params?: unknown
}

interface JsonRpcResponse {
    jsonrpc: "2.0"
    id: number
    result?: unknown
    error?: { code: number; message: string }
}

interface JsonRpcNotification {
    jsonrpc: "2.0"
    method: string
    params: unknown
}

describe("MCP RPC endpoints", () => {
    let serverProcess: ChildProcess
    let requestId = 0
    const pendingRequests = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>()
    const notifications: JsonRpcNotification[] = []

    const additionServerPath = resolve(process.cwd(), "examples/mcp/addition-server.cjs")

    beforeAll(async () => {
        // Start server with MCP config in env
        serverProcess = spawn("node", ["dist/server/index.js"], {
            stdio: ["pipe", "pipe", "inherit"],
            env: {
                ...process.env,
                LOP_DEBUG: "true",
                LOP_PROVIDER: "openai",
                LOP_MODEL: "gpt-4o",
                LOP_MCP_SERVERS: JSON.stringify({
                    "test-addition": {
                        transport: "stdio",
                        command: "node",
                        args: [additionServerPath],
                    },
                }),
            },
        })

        // Set up readline to parse JSON-RPC messages
        const rl = readline.createInterface({
            input: serverProcess.stdout!,
            terminal: false,
        })

        rl.on("line", (line) => {
            try {
                const msg = JSON.parse(line)
                if (msg.id !== undefined) {
                    // Response
                    const pending = pendingRequests.get(msg.id)
                    if (pending) {
                        pendingRequests.delete(msg.id)
                        pending.resolve(msg as JsonRpcResponse)
                    }
                } else if (msg.method) {
                    // Notification
                    notifications.push(msg as JsonRpcNotification)
                }
            } catch {
                // Ignore parse errors
            }
        })

        // Wait a bit for server to be ready
        await new Promise(r => setTimeout(r, 500))

        // Initialize
        await sendRequest("initialize", {
            clientInfo: { name: "test-client", version: "1.0.0" },
        })
    }, 30000)

    afterAll(() => {
        serverProcess?.kill()
    })

    function sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
        return new Promise((resolve, reject) => {
            const id = ++requestId
            const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params }
            pendingRequests.set(id, { resolve, reject })
            serverProcess.stdin!.write(JSON.stringify(request) + "\n")
        })
    }

    it("mcp_list returns server status array", async () => {
        const response = await sendRequest("mcp_list")

        expect(response.error).toBeUndefined()
        expect(response.result).toBeDefined()
        expect(response.result).toHaveProperty("servers")

        const result = response.result as { servers: Array<{ name: string; status: string; error?: string }> }
        expect(Array.isArray(result.servers)).toBe(true)
        expect(result.servers).toHaveLength(1)
        expect(result.servers[0].name).toBe("test-addition")
        // Status could be pending, connecting, connected, or error depending on timing
        expect(["pending", "connecting", "connected", "error"]).toContain(result.servers[0].status)
    })

    it("mcp_reload discovers tools and returns updated status", async () => {
        const response = await sendRequest("mcp_reload")

        expect(response.error).toBeUndefined()
        expect(response.result).toBeDefined()

        const result = response.result as {
            servers: Array<{ name: string; status: string; error?: string }>
            reloaded: boolean
        }

        expect(result).toHaveProperty("servers")
        expect(result).toHaveProperty("reloaded", true)
        expect(Array.isArray(result.servers)).toBe(true)

        if (result.servers[0].status === "connected") {
            // If connected, should have no error
            expect(result.servers[0].error).toBeUndefined()
        }
    }, 30000)

    it("mcp_list fails when not initialized", async () => {
        // Start a fresh server without initialization
        const freshServer = spawn("node", ["dist/server/index.js"], {
            stdio: ["pipe", "pipe", "inherit"],
            env: { ...process.env, LOP_PROVIDER: "openai", LOP_MODEL: "gpt-4o" },
        })

        const freshRequests = new Map<number, { resolve: (r: JsonRpcResponse) => void }>()
        let freshRequestId = 0

        const rl = readline.createInterface({
            input: freshServer.stdout!,
            terminal: false,
        })

        rl.on("line", (line) => {
            try {
                const msg = JSON.parse(line)
                if (msg.id !== undefined) {
                    const pending = freshRequests.get(msg.id)
                    if (pending) {
                        freshRequests.delete(msg.id)
                        pending.resolve(msg as JsonRpcResponse)
                    }
                }
            } catch {
                // Ignore
            }
        })

        await new Promise(r => setTimeout(r, 500))

        const response = await new Promise<JsonRpcResponse>((resolve) => {
            const id = ++freshRequestId
            const request: JsonRpcRequest = { jsonrpc: "2.0", id, method: "mcp_list" }
            freshRequests.set(id, { resolve })
            freshServer.stdin!.write(JSON.stringify(request) + "\n")
        })

        expect(response.error).toBeDefined()
        expect(response.error!.code).toBe(-32002)
        expect(response.error!.message).toBe("Not initialized")

        freshServer.kill()
    }, 30000)

    it("mcp_reload fails when not initialized", async () => {
        // Start a fresh server without initialization
        const freshServer = spawn("node", ["dist/server/index.js"], {
            stdio: ["pipe", "pipe", "inherit"],
            env: { ...process.env, LOP_PROVIDER: "openai", LOP_MODEL: "gpt-4o" },
        })

        const freshRequests = new Map<number, { resolve: (r: JsonRpcResponse) => void }>()
        let freshRequestId = 0

        const rl = readline.createInterface({
            input: freshServer.stdout!,
            terminal: false,
        })

        rl.on("line", (line) => {
            try {
                const msg = JSON.parse(line)
                if (msg.id !== undefined) {
                    const pending = freshRequests.get(msg.id)
                    if (pending) {
                        freshRequests.delete(msg.id)
                        pending.resolve(msg as JsonRpcResponse)
                    }
                }
            } catch {
                // Ignore
            }
        })

        await new Promise(r => setTimeout(r, 500))

        const response = await new Promise<JsonRpcResponse>((resolve) => {
            const id = ++freshRequestId
            const request: JsonRpcRequest = { jsonrpc: "2.0", id, method: "mcp_reload" }
            freshRequests.set(id, { resolve })
            freshServer.stdin!.write(JSON.stringify(request) + "\n")
        })

        expect(response.error).toBeDefined()
        expect(response.error!.code).toBe(-32002)
        expect(response.error!.message).toBe("Not initialized")

        freshServer.kill()
    }, 30000)
})

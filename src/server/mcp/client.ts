import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { McpServerConfig } from "../../protocol/types.js"
import { createMcpTransport, type McpTransport } from "./transport.js"

export type McpClientStatus = "disconnected" | "connecting" | "connected"

export interface DiscoveredTool {
    serverName: string
    toolName: string
    description: string
    inputSchema: unknown
}

/**
 * Single MCP server client
 * Manages connection lifecycle and tool discovery
 */
export class McpClient {
    private client: Client
    private transport?: McpTransport
    private _status: McpClientStatus = "disconnected"

    constructor(
        public readonly serverName: string,
        public readonly config: McpServerConfig
    ) {
        this.client = new Client({ name: "lop-minimal", version: "0.1.0" })
    }

    get status(): McpClientStatus {
        return this._status
    }

    async connect(): Promise<void> {
        if (this._status === "connected") {
            return
        }

        this._status = "connecting"
        try {
            this.transport = await createMcpTransport(this.serverName, this.config)
            await this.client.connect(this.transport)
            this._status = "connected"
        } catch (error) {
            this._status = "disconnected"
            throw error
        }
    }

    async discoverTools(): Promise<DiscoveredTool[]> {
        if (this._status !== "connected") {
            throw new Error(`MCP client '${this.serverName}' is not connected`)
        }

        const response = await this.client.listTools()
        const tools = response.tools || []

        const { includeTools, excludeTools } = this.config

        return tools
            .filter((tool) => {
                // Exclude takes priority
                if (excludeTools?.includes(tool.name)) {
                    return false
                }
                // If include is specified, only include those
                if (includeTools && !includeTools.includes(tool.name)) {
                    return false
                }
                return true
            })
            .map((tool) => ({
                serverName: this.serverName,
                toolName: tool.name,
                description: tool.description || "",
                inputSchema: tool.inputSchema || {},
            }))
    }

    async callTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
        if (this._status !== "connected") {
            throw new Error(`MCP client '${this.serverName}' is not connected`)
        }

        return await this.client.callTool({ name: toolName, arguments: params })
    }

    async disconnect(): Promise<void> {
        if (this._status === "disconnected") {
            return
        }

        try {
            await this.client.close()
        } catch {
            // Ignore close errors
        }

        this._status = "disconnected"
        this.transport = undefined
    }
}

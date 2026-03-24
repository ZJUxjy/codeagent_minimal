import { McpClient, type DiscoveredTool } from "./client.js"
import type { McpServerConfig } from "../../protocol/types.js"

type ServerStatus = "pending" | "connecting" | "connected" | "error"

interface ServerState {
    config: McpServerConfig
    client?: McpClient
    status: ServerStatus
    error?: string
}

/**
 * Manages multiple MCP clients
 * Handles discovery, reconnection, and lifecycle
 */
export class McpClientManager {
    private servers = new Map<string, ServerState>()

    constructor(mcpServers: Record<string, McpServerConfig> = {}) {
        for (const [name, config] of Object.entries(mcpServers)) {
            this.servers.set(name, { config, status: "pending" })
        }
    }

    /**
     * Discover tools from all configured servers
     */
    async discoverAll(): Promise<Map<string, DiscoveredTool[]>> {
        const results = new Map<string, DiscoveredTool[]>()

        for (const [name, state] of this.servers) {
            try {
                const tools = await this.discoverOne(name)
                results.set(name, tools)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`Failed to discover MCP server '${name}':`, message)
                state.status = "error"
                state.error = message
                results.set(name, [])
            }
        }

        return results
    }

    /**
     * Discover tools from a single server
     */
    async discoverOne(serverName: string): Promise<DiscoveredTool[]> {
        const state = this.servers.get(serverName)
        if (!state) {
            throw new Error(`Unknown MCP server: ${serverName}`)
        }

        // Disconnect existing if any
        if (state.client) {
            await state.client.disconnect()
        }

        // Create and connect new client
        state.status = "connecting"
        state.client = new McpClient(serverName, state.config)

        try {
            await state.client.connect()
            const tools = await state.client.discoverTools()
            state.status = "connected"
            state.error = undefined
            return tools
        } catch (error) {
            state.status = "error"
            state.error = error instanceof Error ? error.message : String(error)
            throw error
        }
    }

    /**
     * Get a client for tool execution
     */
    getClient(serverName: string): McpClient | undefined {
        return this.servers.get(serverName)?.client
    }

    /**
     * Get status of all servers
     */
    getStatus(): Array<{ name: string; status: ServerStatus; error?: string }> {
        return Array.from(this.servers.entries()).map(([name, state]) => ({
            name,
            status: state.status,
            error: state.error,
        }))
    }

    /**
     * Stop all clients
     */
    async stop(): Promise<void> {
        for (const state of this.servers.values()) {
            if (state.client) {
                await state.client.disconnect()
                state.client = undefined
                state.status = "pending"
            }
        }
    }
}

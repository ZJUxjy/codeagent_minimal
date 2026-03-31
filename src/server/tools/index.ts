import type { Tool } from "./types.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { bashTool } from "./bash.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import { listDirectoryTool } from "./listDirectory.js"
import { askQuestionTool } from "./askQuestion.js"
import { webfetchTool } from "./webfetch.js"
import { todowriteTool } from "./todowrite.js"
import { saveMemoryTool } from "./memory.js"
import { createDiscoveredMcpTool } from "./mcpTool.js"
import { createBatchTool } from "./batch.js"
import { McpClientManager } from "../mcp/clientManager.js"
import type { McpServerConfig } from "../../protocol/types.js"

export interface ToolRegistryOptions {
    mcpServers?: Record<string, McpServerConfig>
    /** When true, do not register core tools (used when copying a filtered tool set). */
    skipDefaultTools?: boolean
}

export class ToolRegistry {
    private tools = new Map<string, Tool>()
    private mcpManager?: McpClientManager

    constructor(options: ToolRegistryOptions = {}) {
        if (!options.skipDefaultTools) {
            this.register(readTool)
            this.register(writeTool)
            this.register(editTool)
            this.register(bashTool)
            this.register(globTool)
            this.register(grepTool)
            this.register(listDirectoryTool)
            this.register(askQuestionTool)
            this.register(webfetchTool)
            this.register(todowriteTool)
            this.register(saveMemoryTool)
        }

        if (options.mcpServers && Object.keys(options.mcpServers).length > 0) {
            this.mcpManager = new McpClientManager(options.mcpServers)
        }

        // Batch tool needs access to the registry's tool map — register last
        this.register(createBatchTool(() => this.tools))
    }
    register(tool: Tool): void {
        this.tools.set(tool.name, tool)
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name)
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values())
    }

    getToolDefinitions(): Record<string, { description: string; parameters: unknown }> {
        const defs: Record<string, { description: string; parameters: unknown }> = {}
        for (const tool of this.getAll()) {
            defs[tool.name] = {
                description: tool.description,
                parameters: tool.parameters,
            }
        }
        return defs
    }

    /**
     * Discover and register MCP tools from configured servers
     */
    async discoverMcpTools(): Promise<void> {
        if (!this.mcpManager) {
            return
        }

        const results = await this.mcpManager.discoverAll()

        for (const [serverName, tools] of results) {
            // Remove existing tools from this server
            this.removeMcpToolsByServer(serverName)

            // Register new tools
            const client = this.mcpManager.getClient(serverName)
            if (!client) continue

            for (const tool of tools) {
                const mcpTool = createDiscoveredMcpTool(
                    tool.serverName,
                    tool.toolName,
                    tool.description,
                    tool.inputSchema,
                    client
                )
                this.register(mcpTool)
            }
        }
    }

    /**
     * Remove all MCP tools from a specific server
     */
    removeMcpToolsByServer(serverName: string): void {
        const prefix = `mcp__${serverName}__`
        for (const name of this.tools.keys()) {
            if (name.startsWith(prefix)) {
                this.tools.delete(name)
            }
        }
    }

    /**
     * Get MCP manager for advanced operations
     */
    getMcpManager(): McpClientManager | undefined {
        return this.mcpManager
    }
}

export * from "./types.js"


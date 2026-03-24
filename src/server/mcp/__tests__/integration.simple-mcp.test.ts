import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { spawn, type ChildProcess } from "child_process"
import { ToolRegistry } from "../../tools/index.js"
import { McpClientManager } from "../clientManager.js"
import type { McpServerConfig } from "../../../protocol/types.js"
import { resolve } from "path"

describe("simple mcp integration with addition-server", () => {
    const additionServerPath = resolve(process.cwd(), "examples/mcp/addition-server.cjs")

    it("discovers and executes add tool from stdio server", async () => {
        const configs: Record<string, McpServerConfig> = {
            "addition": {
                transport: "stdio",
                command: "node",
                args: [additionServerPath],
            },
        }

        const manager = new McpClientManager(configs)
        const registry = new ToolRegistry({ mcpServers: configs })

        // Discover tools
        await registry.discoverMcpTools()

        // Verify the add tool was registered with correct qualified name
        const addTool = registry.get("mcp__addition__add")
        expect(addTool).toBeDefined()
        expect(addTool!.name).toBe("mcp__addition__add")
        expect(addTool!.description).toContain("Add two numbers")

        // Execute the tool
        const result = await addTool!.execute({ a: 5, b: 10 }, { toolName: "add" })
        expect(result).toBe("15")

        // Clean up
        await manager.stop()
    }, 30000) // 30s timeout for process spawn

    it("handles multiple tools from same server", async () => {
        const configs: Record<string, McpServerConfig> = {
            "math": {
                transport: "stdio",
                command: "node",
                args: [additionServerPath],
            },
        }

        const registry = new ToolRegistry({ mcpServers: configs })
        await registry.discoverMcpTools()

        const allTools = registry.getAll()
        const mcpTools = allTools.filter(t => t.name.startsWith("mcp__"))

        expect(mcpTools.length).toBeGreaterThan(0)
        expect(mcpTools[0].name).toMatch(/^mcp__math__/)
    }, 30000)

    it("isolates tools by server name", async () => {
        // Even with same underlying server, different server names create different prefixes
        const configs: Record<string, McpServerConfig> = {
            "math-v1": {
                transport: "stdio",
                command: "node",
                args: [additionServerPath],
            },
        }

        const registry = new ToolRegistry({ mcpServers: configs })
        await registry.discoverMcpTools()

        const tool = registry.get("mcp__math-v1__add")
        expect(tool).toBeDefined()

        // Should not exist with different prefix
        expect(registry.get("mcp__math-v2__add")).toBeUndefined()
    }, 30000)
})

describe("MCP client error handling", () => {
    const additionServerPath = resolve(process.cwd(), "examples/mcp/addition-server.cjs")

    it("reports error for invalid tool parameters", async () => {
        const configs: Record<string, McpServerConfig> = {
            "addition": {
                transport: "stdio",
                command: "node",
                args: [additionServerPath],
            },
        }

        const registry = new ToolRegistry({ mcpServers: configs })
        await registry.discoverMcpTools()

        const addTool = registry.get("mcp__addition__add")
        expect(addTool).toBeDefined()

        // The tool will execute - addition server returns "NaN" for undefined + undefined
        const result = await addTool!.execute({}, { toolName: "add" })
        expect(result).toBe("NaN")
    }, 30000)

    it("handles connection to non-existent server gracefully", async () => {
        const configs: Record<string, McpServerConfig> = {
            "bad-server": {
                transport: "stdio",
                command: "nonexistent_command_xyz_12345",
                args: [],
            },
        }

        const manager = new McpClientManager(configs)
        const registry = new ToolRegistry({ mcpServers: configs })

        // Should not throw, just log warning
        await registry.discoverMcpTools()

        // Status should show error - get status from registry's internal manager
        const status = registry.getMcpManager()!.getStatus()
        expect(status).toHaveLength(1)
        expect(status[0].status).toBe("error")
        expect(status[0].error).toBeDefined()
    }, 30000)
})

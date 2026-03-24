import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../../tools/index.js"
import { McpClientManager } from "../clientManager.js"
import type { McpServerConfig } from "../../../protocol/types.js"

describe("McpClientManager", () => {
    it("initializes with pending status for all servers", () => {
        const configs: Record<string, McpServerConfig> = {
            "server-a": { transport: "stdio", command: "node", args: ["server-a.js"] },
            "server-b": { transport: "stdio", command: "node", args: ["server-b.js"] },
        }
        const manager = new McpClientManager(configs)

        const status = manager.getStatus()

        expect(status).toHaveLength(2)
        expect(status.map(s => s.name).sort()).toEqual(["server-a", "server-b"])
        expect(status.every(s => s.status === "pending")).toBe(true)
    })

    it("returns empty array when no servers configured", () => {
        const manager = new McpClientManager({})
        expect(manager.getStatus()).toEqual([])
    })

    it("getStatus returns error field when server has error", async () => {
        // Invalid command will cause error on discover
        const configs: Record<string, McpServerConfig> = {
            "bad-server": { transport: "stdio", command: "nonexistent_command_xyz", args: [] },
        }
        const manager = new McpClientManager(configs)

        // Try to discover - will fail but shouldn't throw
        await manager.discoverAll()

        const status = manager.getStatus()
        expect(status).toHaveLength(1)
        expect(status[0].status).toBe("error")
        expect(status[0].error).toBeDefined()
    })

    it("throws error for unknown server in discoverOne", async () => {
        const manager = new McpClientManager({})
        await expect(manager.discoverOne("unknown")).rejects.toThrow("Unknown MCP server: unknown")
    })

    it("getClient returns undefined for unknown server", () => {
        const manager = new McpClientManager({})
        expect(manager.getClient("unknown")).toBeUndefined()
    })
})

describe("ToolRegistry MCP integration", () => {
    it("registers core tools without MCP manager when no servers configured", () => {
        const registry = new ToolRegistry({})

        expect(registry.get("read")).toBeDefined()
        expect(registry.get("write")).toBeDefined()
        expect(registry.get("edit")).toBeDefined()
        expect(registry.get("bash")).toBeDefined()
        expect(registry.get("glob")).toBeDefined()
        expect(registry.get("grep")).toBeDefined()
        expect(registry.get("list_directory")).toBeDefined()
    })

    it("creates MCP manager when servers are configured", () => {
        const configs: Record<string, McpServerConfig> = {
            "test-server": { transport: "stdio", command: "node", args: ["test.js"] },
        }
        const registry = new ToolRegistry({ mcpServers: configs })

        expect(registry.getMcpManager()).toBeDefined()
    })

    it("has no MCP manager when no servers configured", () => {
        const registry = new ToolRegistry({})
        expect(registry.getMcpManager()).toBeUndefined()
    })

    it("discoverMcpTools does nothing when no MCP manager exists", async () => {
        const registry = new ToolRegistry({})
        // Should not throw
        await registry.discoverMcpTools()

        // Only core tools should exist
        const allTools = registry.getAll()
        expect(allTools.every(t => !t.name.startsWith("mcp__"))).toBe(true)
    })

    it("removeMcpToolsByServer removes only tools from specified server", () => {
        const registry = new ToolRegistry({})

        // Register some mock MCP tools manually
        const mockTool1 = {
            name: "mcp__server1__tool1",
            description: "Test tool",
            parameters: { type: "object" },
            async execute() { return "test" },
        }
        const mockTool2 = {
            name: "mcp__server2__tool1",
            description: "Test tool",
            parameters: { type: "object" },
            async execute() { return "test" },
        }
        const coreTool = registry.get("read")

        registry.register(mockTool1)
        registry.register(mockTool2)

        // Remove server1 tools
        registry.removeMcpToolsByServer("server1")

        expect(registry.get("mcp__server1__tool1")).toBeUndefined()
        expect(registry.get("mcp__server2__tool1")).toBeDefined()
        expect(registry.get("read")).toBe(coreTool) // Core tools unaffected
    })
})

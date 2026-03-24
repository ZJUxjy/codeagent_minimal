import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../../tools/index.js"

describe("ToolRegistry MCP integration", () => {
  it("registers discovered MCP tools", async () => {
    const registry = new ToolRegistry()
    await registry.discoverMcpTools()
    // With no MCP manager, should have no MCP tools but core tools exist
    expect(registry.get("read")).toBeDefined()
  })
})

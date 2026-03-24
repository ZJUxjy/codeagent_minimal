import { describe, it, expect } from "vitest"
import { createMcpToolName } from "../../tools/mcpTool.js"

describe("createMcpToolName", () => {
  it("creates qualified name", () => {
    expect(createMcpToolName("browser", "navigate")).toBe("mcp__browser__navigate")
  })
})

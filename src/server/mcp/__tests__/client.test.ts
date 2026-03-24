import { describe, it, expect } from "vitest"
import { McpClient } from "../client.js"

describe("McpClient", () => {
  it("rejects discover when not connected", async () => {
    const c = new McpClient("x", { command: "node", args: ["srv.js"] })
    await expect(c.discoverTools()).rejects.toThrow("not connected")
  })
})

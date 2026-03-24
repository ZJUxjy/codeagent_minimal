import { describe, it, expect } from "vitest"
import { createMcpTransport } from "../transport.js"

describe("createMcpTransport", () => {
  it("creates stdio transport when command exists", async () => {
    const transport = await createMcpTransport("fs", { command: "node", args: ["x.js"] })
    expect(transport).toBeDefined()
  })
})

import { describe, it, expect } from "vitest"
import { parseMcpConfig } from "../config.js"

describe("parseMcpConfig", () => {
  it("parses stdio/http/sse servers", () => {
    const cfg = parseMcpConfig({
      mcpServers: {
        fs: { command: "node", args: ["server.js"] },
        api: { httpUrl: "http://localhost:3000/mcp" },
        legacy: { url: "http://localhost:4000/sse" }
      }
    })
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(["fs", "api", "legacy"])
  })
})

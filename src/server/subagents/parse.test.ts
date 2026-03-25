import { describe, it, expect } from "vitest"
import { parseSubagentMarkdown } from "./parse.js"

const SAMPLE = `---
name: demo-agent
description: For tests
tools:
  - read
  - grep
---

You are a **test** subagent.
`

describe("parseSubagentMarkdown", () => {
    it("rejects missing frontmatter", () => {
        expect(() =>
            parseSubagentMarkdown("no frontmatter", { level: "project" }),
        ).toThrow(/frontmatter/)
    })

    it("parses name, description, tools, body", () => {
        const c = parseSubagentMarkdown(SAMPLE, { level: "project", filePath: "/x/demo.md" })
        expect(c.name).toBe("demo-agent")
        expect(c.description).toBe("For tests")
        expect(c.tools).toEqual(["read", "grep"])
        expect(c.systemPrompt).toContain("test")
        expect(c.level).toBe("project")
        expect(c.filePath).toBe("/x/demo.md")
        expect(c.isBuiltin).toBe(false)
    })

    it("rejects empty name", () => {
        const bad = `---
name: ""
description: x
---
body
`
        expect(() => parseSubagentMarkdown(bad, { level: "project" })).toThrow(/name/)
    })
})

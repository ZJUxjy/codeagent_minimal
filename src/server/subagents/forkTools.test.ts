import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../tools/index.js"
import { forkChildToolRegistry } from "./forkTools.js"
import type { SubagentConfig } from "./types.js"

describe("forkChildToolRegistry", () => {
    it("drops delegation tool and honors allowlist", () => {
        const parent = new ToolRegistry()
        const fakeDelegate = {
            name: "agent",
            description: "x",
            parameters: {} as any,
            execute: async () => "",
        }
        parent.register(fakeDelegate)

        const sub: SubagentConfig = {
            name: "x",
            description: "y",
            systemPrompt: "z",
            level: "builtin",
            tools: ["read", "glob"],
        }
        const child = forkChildToolRegistry(parent, sub)
        const names = child.getAll().map((t) => t.name).sort()
        expect(names).toContain("glob")
        expect(names).toContain("read")
        expect(names).not.toContain("agent")
        expect(names).not.toContain("write")
    })

    it("includes all non-agent parent tools when tools omitted", () => {
        const parent = new ToolRegistry()
        const child = forkChildToolRegistry(parent, {
            name: "x",
            description: "y",
            systemPrompt: "z",
            level: "builtin",
        })
        const parentNames = new Set(parent.getAll().map((t) => t.name))
        parentNames.delete("agent")
        const childNames = new Set(child.getAll().map((t) => t.name))
        expect(childNames).toEqual(parentNames)
    })
})

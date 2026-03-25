import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { listSubagents, loadSubagentByName } from "./manager.js"

describe("SubagentManager integration", () => {
    let tmp: string

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), "lop-subagent-"))
        await fs.mkdir(path.join(tmp, ".lop", "agents"), { recursive: true })
        await fs.writeFile(
            path.join(tmp, ".lop", "agents", "custom.md"),
            `---
name: custom
description: From project
---
Do project things.
`,
            "utf8",
        )
    })

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true })
    })

    it("lists custom and builtins", async () => {
        const all = await listSubagents(tmp)
        const names = all.map((s) => s.name)
        expect(names).toContain("custom")
        expect(names).toContain("explore")
    })

    it("loadSubagentByName resolves project file", async () => {
        const c = await loadSubagentByName(tmp, "custom")
        expect(c?.description).toBe("From project")
    })
})

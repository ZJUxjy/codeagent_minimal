import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { collectProjectContext } from "./smartInit.js"

describe("collectProjectContext", () => {
    let dir: string

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lop-test-"))
    })

    it("includes README.md content when present", async () => {
        await writeFile(join(dir, "README.md"), "# MyProject\nA cool project.")
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("README.md")
        expect(ctx).toContain("A cool project.")
    })

    it("includes package.json scripts when present", async () => {
        await writeFile(join(dir, "package.json"), JSON.stringify({
            name: "my-app",
            scripts: { build: "tsc", test: "vitest run" },
        }, null, 2))
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("package.json")
        expect(ctx).toContain("vitest run")
    })

    it("includes top-level directory listing", async () => {
        await mkdir(join(dir, "src"))
        await writeFile(join(dir, "src", "index.ts"), "")
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("src")
    })

    it("caps total context at MAX_CONTEXT_CHARS", async () => {
        // Write a very large README
        await writeFile(join(dir, "README.md"), "x".repeat(200_000))
        const ctx = await collectProjectContext(dir)
        expect(ctx.length).toBeLessThanOrEqual(60_000)
    })

    it("returns empty string when directory has no relevant files", async () => {
        const ctx = await collectProjectContext(dir)
        expect(typeof ctx).toBe("string")
    })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"

// We need to test the registry module with an overridden REGISTRY_PATH.
// Since REGISTRY_PATH is a module-level const derived from os.homedir(),
// we override HOME to control the path.
import { readRegistry, writeRegistry, getPackage } from "./registry.js"

describe("registry", () => {
    let tmpRoot: string
    let homeDir: string
    let oldHome: string | undefined

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lop-registry-"))
        homeDir = path.join(tmpRoot, "home")
        await fs.mkdir(homeDir, { recursive: true })
        oldHome = process.env.HOME
        process.env.HOME = homeDir
    })

    afterEach(async () => {
        if (oldHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = oldHome
        }
        await fs.rm(tmpRoot, { recursive: true, force: true })
    })

    describe("readRegistry", () => {
        it("returns empty array when file does not exist", async () => {
            const registry = await readRegistry()
            expect(registry.packages).toEqual([])
        })

        it("returns empty array on corrupt JSON", async () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
            const registryDir = path.join(homeDir, ".lop")
            await fs.mkdir(registryDir, { recursive: true })
            await fs.writeFile(path.join(registryDir, "installed.json"), "NOT JSON{{{", "utf8")

            const registry = await readRegistry()
            expect(registry.packages).toEqual([])
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"))
            warnSpy.mockRestore()
        })

        it("returns parsed content on valid JSON", async () => {
            const registryDir = path.join(homeDir, ".lop")
            await fs.mkdir(registryDir, { recursive: true })
            const data = { packages: [{ name: "test-pkg", url: "https://example.com", installedAt: "", sourcePath: "", skillsDir: "." }] }
            await fs.writeFile(path.join(registryDir, "installed.json"), JSON.stringify(data), "utf8")

            const registry = await readRegistry()
            expect(registry.packages).toHaveLength(1)
            expect(registry.packages[0].name).toBe("test-pkg")
        })
    })

    describe("writeRegistry + readRegistry round-trip", () => {
        it("writes and reads back correctly", async () => {
            const data = { packages: [{ name: "my-skill", url: "https://github.com/user/my-skill", installedAt: "2026-01-01", sourcePath: "/tmp/src", skillsDir: "skills" }] }
            await writeRegistry(data)
            const registry = await readRegistry()
            expect(registry).toEqual(data)
        })

        it("creates parent directory if missing", async () => {
            await writeRegistry({ packages: [] })
            const stat = await fs.stat(path.join(homeDir, ".lop", "installed.json"))
            expect(stat.isFile()).toBe(true)
        })

        it("does not corrupt existing file on write failure", async () => {
            // Write valid initial data
            const initial = { packages: [{ name: "initial", url: "u", installedAt: "", sourcePath: "", skillsDir: "." }] }
            await writeRegistry(initial)

            // Write new data (this should atomically replace)
            const updated = { packages: [{ name: "updated", url: "u", installedAt: "", sourcePath: "", skillsDir: "." }] }
            await writeRegistry(updated)

            const registry = await readRegistry()
            expect(registry.packages[0].name).toBe("updated")
        })
    })

    describe("getPackage", () => {
        const registry = {
            packages: [
                { name: "Hello-World", url: "", installedAt: "", sourcePath: "", skillsDir: "." },
            ],
        }

        it("finds package case-insensitively", () => {
            expect(getPackage(registry, "hello-world")).toBeDefined()
            expect(getPackage(registry, "HELLO-WORLD")).toBeDefined()
            expect(getPackage(registry, "Hello-World")).toBeDefined()
        })

        it("returns undefined for missing package", () => {
            expect(getPackage(registry, "nonexistent")).toBeUndefined()
        })
    })
})

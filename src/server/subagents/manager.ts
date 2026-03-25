import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { parseSubagentMarkdown } from "./parse.js"
import type { SubagentConfig } from "./types.js"
import { getBuiltinSubagent, listBuiltinSubagents } from "./builtin.js"
import { namesMatch } from "./validation.js"

const DIR = "agents"
const ROOT = ".lop"

function projectAgentsDir(cwd: string): string {
    return path.join(cwd, ROOT, DIR)
}

function userAgentsDir(): string {
    return path.join(os.homedir(), ROOT, DIR)
}

async function readDirMdSafe(dir: string): Promise<string[]> {
    try {
        const names = await fs.readdir(dir)
        return names.filter((n) => n.endsWith(".md")).map((n) => path.join(dir, n))
    } catch (e: unknown) {
        const err = e as NodeJS.ErrnoException
        if (err.code === "ENOENT") return []
        throw e
    }
}

async function loadFromFile(filePath: string, level: "project" | "user"): Promise<SubagentConfig> {
    const content = await fs.readFile(filePath, "utf8")
    return parseSubagentMarkdown(content, { level, filePath })
}

/**
 * Merge by name: project overrides user; builtins only used when name not taken.
 */
export async function listSubagents(cwd: string): Promise<SubagentConfig[]> {
    const builtins = listBuiltinSubagents()
    const userFiles = await readDirMdSafe(userAgentsDir())
    const projFiles = await readDirMdSafe(projectAgentsDir(cwd))

    const merged = new Map<string, SubagentConfig>()

    for (const b of builtins) {
        merged.set(b.name.toLowerCase(), b)
    }

    for (const file of userFiles) {
        const c = await loadFromFile(file, "user")
        merged.set(c.name.toLowerCase(), c)
    }

    for (const file of projFiles) {
        const c = await loadFromFile(file, "project")
        merged.set(c.name.toLowerCase(), c)
    }

    return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadSubagentByName(cwd: string, name: string): Promise<SubagentConfig | null> {
    const n = name.trim()
    if (!n) return null

    const projFiles = await readDirMdSafe(projectAgentsDir(cwd))
    for (const file of projFiles) {
        const c = await loadFromFile(file, "project")
        if (namesMatch(c.name, n)) return c
    }

    const userFiles = await readDirMdSafe(userAgentsDir())
    for (const file of userFiles) {
        const c = await loadFromFile(file, "user")
        if (namesMatch(c.name, n)) return c
    }

    return getBuiltinSubagent(n)
}

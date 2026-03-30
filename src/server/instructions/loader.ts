import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { findGitRoot } from "../utils/git.js"
import { truncate } from "../../utils/truncate.js"
import { debugLog } from "../../config.js"

const INSTRUCTION_FILENAMES = ["LOP.md", "CLAUDE.md", "AGENTS.md"]
const MAX_FILE_SIZE = 50 * 1024 // 50 KB

export interface InstructionFile {
    path: string
    content: string
    size: number
}

// Silent skip on missing files prevents noise from directories without instructions;
// 50KB limit prevents prompt pollution from oversized files.
async function tryReadFile(filePath: string): Promise<{ content: string; size: number } | null> {
    try {
        const raw = await fs.readFile(filePath, "utf8")
        const trimmed = raw.trim()
        if (!trimmed) return null

        const size = Buffer.byteLength(raw, "utf8")
        if (size > MAX_FILE_SIZE) {
            return {
                content: truncate(trimmed, MAX_FILE_SIZE, "\n<!-- truncated: file exceeded 50KB limit -->"),
                size,
            }
        }
        return { content: trimmed, size }
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException
        if (err.code === "ENOENT") return null
        debugLog("instructions", `Failed to read ${filePath}: ${err.message}`)
        return null
    }
}

/** Collect all directories from root down to cwd, inclusive (ancestor-first order). */
function collectDirsFromRootToCwd(root: string, cwd: string): string[] {
    const resolvedRoot = path.resolve(root)
    const resolvedCwd = path.resolve(cwd)
    const dirs: string[] = []

    // Walk from root down to cwd
    let current = resolvedCwd
    const stack: string[] = []
    while (true) {
        stack.push(current)
        if (current === resolvedRoot) break
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    // Reverse so root is first
    for (let i = stack.length - 1; i >= 0; i--) {
        dirs.push(stack[i])
    }
    return dirs
}

function formatInstructionPath(filePath: string): string {
    const home = os.homedir()
    if (filePath.startsWith(home)) {
        return "~" + filePath.slice(home.length)
    }
    return filePath
}

function formatInstructionSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} chars`
    return `${(bytes / 1024).toFixed(1)} KB`
}

function formatInstructions(files: InstructionFile[]): string {
    const parts = files.map((f) => {
        const marker = `<!-- Source: ${f.path} -->`
        return `${marker}\n${f.content}`
    })
    return `# Project Instructions\n\n${parts.join("\n\n")}`
}

export async function loadProjectInstructions(cwd: string): Promise<string | undefined> {
    const files = await discoverInstructionFiles(cwd)
    if (files.length === 0) return undefined
    return formatInstructions(files)
}

export async function discoverInstructionFiles(cwd: string): Promise<InstructionFile[]> {
    const files: InstructionFile[] = []

    // 1. Global user file
    const globalPath = path.join(os.homedir(), ".lop", "instructions.md")
    const globalResult = await tryReadFile(globalPath)
    if (globalResult) {
        files.push({ path: globalPath, content: globalResult.content, size: globalResult.size })
    }

    // 2. Upward traversal from cwd to git root (ancestor-first order)
    const gitRoot = findGitRoot(cwd)
    const dirs = collectDirsFromRootToCwd(gitRoot ?? cwd, cwd)
    for (const dir of dirs) {
        // Check all filenames in parallel; use first match
        const checks = await Promise.all(
            INSTRUCTION_FILENAMES.map(async (name) => {
                const filePath = path.join(dir, name)
                const result = await tryReadFile(filePath)
                return result ? { path: filePath, ...result } : null
            })
        )
        const first = checks.find(Boolean)
        if (first) {
            files.push(first)
        }
    }

    return files
}

export { formatInstructionPath, formatInstructionSize }

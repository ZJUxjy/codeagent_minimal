import { readFile, readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import type { CoreMessage } from "ai"
import { LLMClient, type LLMConfig } from "../../llm.js"
import { LOP_MD_GENERATION_PROMPT } from "./lopMdPrompt.js"

const MAX_CONTEXT_CHARS = 50_000
const MAX_FILE_CHARS    = 15_000

/** Files to read in priority order. Stops once MAX_CONTEXT_CHARS is reached. */
const CANDIDATE_FILES = [
    "README.md",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Makefile",
    "CLAUDE.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
]

/** Read a file and cap it at MAX_FILE_CHARS (mid-truncation marker). */
async function readCapped(filePath: string): Promise<string> {
    const raw = await readFile(filePath, "utf-8")
    if (raw.length <= MAX_FILE_CHARS) return raw
    const half = Math.floor(MAX_FILE_CHARS / 2)
    return raw.slice(0, half) + `\n... [truncated] ...\n` + raw.slice(raw.length - half)
}

/** Collect project files into a single context string for the LLM. */
export async function collectProjectContext(cwd: string): Promise<string> {
    const parts: string[] = []
    let totalChars = 0

    // Top-level directory listing
    try {
        const entries = await readdir(cwd)
        const listing = entries.join("  ")
        parts.push(`## Directory listing (top-level)\n${listing}`)
        totalChars += listing.length
    } catch { /* ignore */ }

    // Priority files
    for (const rel of CANDIDATE_FILES) {
        if (totalChars >= MAX_CONTEXT_CHARS) break
        const fullPath = join(cwd, rel)
        if (!existsSync(fullPath)) continue
        try {
            const content = await readCapped(fullPath)
            parts.push(`## ${rel}\n${content}`)
            totalChars += content.length
        } catch { /* ignore */ }
    }

    return parts.join("\n\n")
}

/** Run smart init: scan project, call LLM, return generated LOP.md content. */
export async function runSmartInit(cwd: string, llmConfig: LLMConfig): Promise<string> {
    const context = await collectProjectContext(cwd)
    const llm = new LLMClient(llmConfig)

    const messages: CoreMessage[] = [
        {
            role: "user",
            content: context
                ? `Here is information about the project:\n\n${context}\n\nGenerate LOP.md for this project.`
                : "Generate a minimal LOP.md for an empty project.",
        },
    ]

    const result = await llm.complete(LOP_MD_GENERATION_PROMPT, messages)
    return result?.trim() ?? ""
}

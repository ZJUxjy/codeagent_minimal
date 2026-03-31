import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import * as path from "path"
import type { Tool, ToolContext } from "./types.js"
import { getBaseDir } from "../utils/storagePath.js"

const SECTION_HEADER = "## Memories"
const GLOBAL_MEMORY_PATH = path.join(getBaseDir(), "MEMORY.md")

function getProjectMemoryPath(cwd: string): string {
    return path.join(cwd, "MEMORY.md")
}

async function appendMemory(filePath: string, fact: string): Promise<void> {
    const dir = path.dirname(filePath)
    await mkdir(dir, { recursive: true })

    let content = ""
    try {
        content = await readFile(filePath, "utf-8")
    } catch {
        // file does not exist yet — start fresh
    }

    if (!content.includes(SECTION_HEADER)) {
        content = content.trimEnd() + (content ? "\n\n" : "") + SECTION_HEADER + "\n"
    }

    content = content.trimEnd() + "\n- " + fact + "\n"
    await writeFile(filePath, content, "utf-8")
}

export const saveMemoryTool: Tool = {
    name: "save_memory",
    description: `Save a fact or piece of information to persistent memory across sessions.
- scope=project saves to MEMORY.md in the current project directory
- scope=global saves to ~/.lop/MEMORY.md shared across all projects
- Memories are automatically loaded as context at session start
- Use for preferences, conventions, and important facts worth remembering`,
    parameters: z.object({
        fact: z.string().min(1).describe("The fact or information to remember"),
        scope: z.enum(["project", "global"]).default("project")
            .describe("Where to save: project (current repo) or global (all projects)"),
    }),

    async execute({ fact, scope }: { fact: string; scope: "project" | "global" }, ctx: ToolContext) {
        const filePath = scope === "global"
            ? GLOBAL_MEMORY_PATH
            : getProjectMemoryPath(ctx.cwd)

        await appendMemory(filePath, fact)
        return `Memory saved (${scope}): ${fact}`
    },
}

/** Load memories from MEMORY.md files to inject into system prompt */
export async function loadMemories(cwd: string): Promise<string | undefined> {
    const sources = [
        getProjectMemoryPath(cwd),
        GLOBAL_MEMORY_PATH,
    ]

    const sections: string[] = []
    for (const filePath of sources) {
        try {
            const content = await readFile(filePath, "utf-8")
            const label = filePath.startsWith(cwd) ? "Project memories" : "Global memories"
            sections.push(`### ${label}\n${content.trim()}`)
        } catch {
            // file does not exist or is unreadable
        }
    }

    if (sections.length === 0) return undefined
    return `# Persistent Memory\n\n${sections.join("\n\n")}`
}

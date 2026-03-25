import { parse as parseYaml } from "yaml"
import type { SubagentLevel } from "./types.js"
import type { SubagentConfig } from "./types.js"
import { validateSubagentFields } from "./validation.js"

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/

/**
 * Parse a subagent markdown file: YAML frontmatter + markdown body as systemPrompt.
 */
export function parseSubagentMarkdown(
    content: string,
    meta: { level: SubagentLevel; filePath?: string },
): SubagentConfig {
    const m = content.match(FRONTMATTER)
    if (!m) {
        throw new Error("Subagent markdown must start with YAML frontmatter (--- ... ---)")
    }

    const fmRaw = parseYaml(m[1], { uniqueKeys: false }) as Record<string, unknown> | null
    if (!fmRaw || typeof fmRaw !== "object") {
        throw new Error("Subagent frontmatter must be a YAML mapping")
    }

    const systemPrompt = m[2].trim()

    validateSubagentFields({
        name: fmRaw.name,
        description: fmRaw.description,
        systemPrompt,
        tools: fmRaw.tools,
    })

    const name = String(fmRaw.name).trim()
    const description = String(fmRaw.description).trim()
    const tools = fmRaw.tools as string[] | undefined

    return {
        name,
        description,
        systemPrompt,
        tools: tools?.length ? tools : undefined,
        level: meta.level,
        filePath: meta.filePath,
        isBuiltin: meta.level === "builtin",
    }
}

/**
 * Subagent definitions (file-backed + builtin), aligned with qwen-code subagent concepts.
 */

export type SubagentLevel = "session" | "project" | "user" | "builtin"

export interface SubagentConfig {
    /** Unique name (tool parameter subagent_type) */
    name: string
    /** Shown to the LLM in the agent tool description */
    description: string
    /** Body markdown under YAML frontmatter — used as system prompt for the child run */
    systemPrompt: string
    /** Where this definition was loaded from */
    level: SubagentLevel
    /**
     * If set, only these tool names are exposed to the child (allowlist).
     * If omitted or empty, child inherits the full parent tool set (except delegation tool).
     */
    tools?: string[]
    /** Absolute path to the source .md file when loaded from disk */
    filePath?: string
    isBuiltin?: boolean
}

import type { SubagentConfig } from "./types.js"

const EXPLORE: SubagentConfig = {
    name: "explore",
    description:
        "Fast read-only exploration: search with glob/grep, read files. No writes, no bash that mutates state.",
    systemPrompt: `You are a read-only codebase explorer.

Strict rules:
- Do not use write, edit, or bash for destructive/mutating commands.
- Prefer glob, grep, read, listDirectory.
- Reply with absolute paths when possible and a concise findings summary.`,
    level: "builtin",
    isBuiltin: true,
    tools: ["read", "glob", "grep", "listDirectory"],
}

const GENERAL: SubagentConfig = {
    name: "general-purpose",
    description:
        "General multi-step work: search, read, and edit files, run safe shell when needed. Use for broader tasks.",
    systemPrompt: `You are a general-purpose subagent. Complete the delegated task using available tools.
When finished, respond with a short report the main agent can relay to the user.`,
    level: "builtin",
    isBuiltin: true,
}

const BUILTIN_LIST: SubagentConfig[] = [EXPLORE, GENERAL]

const byLower = new Map(BUILTIN_LIST.map((s) => [s.name.toLowerCase(), s]))

export function listBuiltinSubagents(): SubagentConfig[] {
    return [...BUILTIN_LIST]
}

export function getBuiltinSubagent(name: string): SubagentConfig | null {
    return byLower.get(name.trim().toLowerCase()) ?? null
}

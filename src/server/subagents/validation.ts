export function validateSubagentFields(data: {
    name: unknown
    description: unknown
    systemPrompt: unknown
    tools?: unknown
}): void {
    if (typeof data.name !== "string" || !data.name.trim()) {
        throw new Error('Subagent frontmatter: "name" must be a non-empty string')
    }
    if (typeof data.description !== "string" || !data.description.trim()) {
        throw new Error('Subagent frontmatter: "description" must be a non-empty string')
    }
    if (typeof data.systemPrompt !== "string" || !data.systemPrompt.trim()) {
        throw new Error("Subagent must have non-empty body (system prompt) after frontmatter")
    }
    if (data.tools !== undefined) {
        if (!Array.isArray(data.tools) || !data.tools.every((t) => typeof t === "string")) {
            throw new Error('Subagent frontmatter: "tools" must be an array of strings when set')
        }
    }
}

/** Case-insensitive equality */
export function namesMatch(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase()
}


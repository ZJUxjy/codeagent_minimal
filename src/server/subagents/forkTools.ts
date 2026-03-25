import { ToolRegistry } from "../tools/index.js"
import type { SubagentConfig } from "./types.js"

const DELEGATION_TOOL = "agent"

/**
 * Build a registry that reuses tool instances from the parent (same MCP clients, no second discovery).
 * Omits the delegation tool to prevent unbounded recursion. If {@link SubagentConfig.tools} is set,
 * only those names (case-insensitive) are included (plus any mcp__* names listed there).
 */
export function forkChildToolRegistry(parent: ToolRegistry, subagent: SubagentConfig): ToolRegistry {
    const child = new ToolRegistry({ skipDefaultTools: true })
    const allow = subagent.tools?.length
        ? new Set(subagent.tools.map((n) => n.trim().toLowerCase()))
        : null

    for (const tool of parent.getAll()) {
        if (tool.name === DELEGATION_TOOL) {
            continue
        }
        if (allow && !allow.has(tool.name.toLowerCase())) {
            continue
        }
        child.register(tool)
    }
    return child
}

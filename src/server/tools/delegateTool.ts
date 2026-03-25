import { z } from "zod"
import type { Tool } from "./types.js"
import type { Agent } from "../agent.js"
import { loadSubagentByName } from "../subagents/manager.js"

const params = z.object({
    description: z.string().min(1).describe("Short (3–5 word) summary of the delegated task"),
    prompt: z.string().min(1).describe("Full instructions for the subagent"),
    subagent_type: z
        .string()
        .min(1)
        .describe('Which agent profile to run: e.g. "explore", "general-purpose", or a name from .lop/agents'),
})

export function createDelegationTool(getParent: () => Agent): Tool {
    return {
        name: "agent",
        description: `Delegate a sub-task to a specialized agent (same process, isolated context). Returns its final report as the tool result.

Available built-ins:
- **explore**: read-only search (glob/grep/read).
- **general-purpose**: full tool access (no nested delegation).

Project agents: Markdown + YAML in \`.lop/agents/*.md\` (and \`~/.lop/agents\`), same layout as the plan doc.

Parameters: description (short), prompt (task), subagent_type (which profile).`,
        parameters: params,
        execute: async (args, ctx) => {
            const { runChildAgent } = await import("../subagents/runChildAgent.js")
            const parent = getParent()
            const sub = await loadSubagentByName(ctx.cwd, args.subagent_type)
            if (!sub) {
                return `Error: Subagent "${args.subagent_type}" not found.`
            }
            return runChildAgent(parent, sub, args.prompt, ctx.signal)
        },
    }
}

import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const MAX_BATCH = 10
const ALLOWED = new Set(["read", "glob", "grep", "listDirectory"])

export function createBatchTool(getTools: () => Map<string, Tool>): Tool {
    return {
        name: "batch",
        description: `Execute multiple read-only tool calls in parallel for efficiency.
- Use when operations are independent (reading multiple files, searching the codebase)
- Do NOT use when operations depend on each other's results
- Cannot batch mutating tools
- Max ${MAX_BATCH} calls per batch`,
        parameters: z.object({
            tool_calls: z.array(z.object({
                tool: z.string().describe("Tool name to execute"),
                parameters: z.record(z.unknown()).describe("Parameters for the tool"),
            }))
            .min(1, "Provide at least one tool call")
            .max(MAX_BATCH, `Max ${MAX_BATCH} tool calls per batch`),
        }),

        async execute(
            { tool_calls }: { tool_calls: Array<{ tool: string; parameters: Record<string, unknown> }> },
            ctx: ToolContext,
        ) {
            const tools = getTools()
            const results = await Promise.all(
                tool_calls.map(async (call) => {
                    if (!ALLOWED.has(call.tool) || call.tool.startsWith("mcp__")) {
                        return { tool: call.tool, error: `tool not allowed in batch: ${call.tool}` }
                    }
                    const tool = tools.get(call.tool)
                    if (!tool) {
                        return { tool: call.tool, error: `unknown tool: ${call.tool}` }
                    }
                    try {
                        const parsed = tool.parameters.parse(call.parameters)
                        const result = await tool.execute(parsed, ctx)
                        return { tool: call.tool, result }
                    } catch (err: any) {
                        return { tool: call.tool, error: err?.message ?? String(err) }
                    }
                }),
            )

            const failed = results.filter(r => "error" in r).length
            const succeeded = results.length - failed
            const summary = `Batch: ${results.length} calls, ${succeeded} succeeded, ${failed} failed`
            const details = results.map(r =>
                "error" in r ? `[${r.tool}] ERROR: ${r.error}` : `[${r.tool}] OK`
            ).join("\n")

            return `${summary}\n\n${details}`
        },
    }
}

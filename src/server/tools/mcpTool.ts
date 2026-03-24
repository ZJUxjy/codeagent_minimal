import { z } from "zod"
import type { Tool } from "./types.js"
import type { McpClient } from "../mcp/client.js"

/**
 * Create qualified MCP tool name
 * Format: mcp__<server>__<tool>
 */
export function createMcpToolName(server: string, tool: string): string {
    return `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

/**
 * Normalize MCP content blocks to string for Tool interface
 */
function normalizeMcpContent(result: unknown): string {
    if (typeof result === "string") {
        return result
    }

    // Handle MCP content blocks
    if (result && typeof result === "object") {
        // Check for content array
        if ("content" in result && Array.isArray(result.content)) {
            return result.content
                .map((block: unknown) => {
                    if (typeof block === "string") return block
                    if (block && typeof block === "object") {
                        if ("text" in block) return String(block.text)
                        if ("data" in block) return String(block.data)
                        if ("uri" in block) return `[Resource: ${block.uri}]`
                    }
                    return String(block)
                })
                .join("\n")
        }

        // Single content block
        if ("text" in result) return String(result.text)
        if ("data" in result) return String(result.data)

        // Fallback to JSON
        return JSON.stringify(result, null, 2)
    }

    return String(result)
}

/**
 * Create a Tool from a discovered MCP tool
 */
export function createDiscoveredMcpTool(
    serverName: string,
    toolName: string,
    description: string,
    inputSchema: unknown,
    client: McpClient
): Tool {
    const qualifiedName = createMcpToolName(serverName, toolName)

    return {
        name: qualifiedName,
        description: `${description} (${serverName} MCP Server)`,
        parameters: z.object({}).passthrough(),
        async execute(params, _ctx) {
            try {
                const result = await client.callTool(toolName, params)
                return normalizeMcpContent(result)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return `Error: ${message}`
            }
        },
    }
}

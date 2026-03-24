import type { LopConfig, McpServerConfig } from "../../protocol/types.js"
import { z } from "zod"

const McpServerConfigSchema = z.object({
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    env: z.record(z.string()).optional(),
    cwd: z.string().optional(),
    httpUrl: z.string().optional(),
    url: z.string().optional(),
    headers: z.record(z.string()).optional(),
    timeout: z.number().optional(),
    includeTools: z.array(z.string()).optional(),
    excludeTools: z.array(z.string()).optional(),
}).refine(
    (data) => data.command || data.httpUrl || data.url,
    { message: "MCP server must have command, httpUrl, or url" }
)

const McpConfigSchema = z.object({
    allowed: z.array(z.string()).optional(),
    excluded: z.array(z.string()).optional(),
}).optional()

const ConfigSchema = z.object({
    mcpServers: z.record(McpServerConfigSchema).optional(),
    mcp: McpConfigSchema,
}).passthrough()

/**
 * Parse and validate MCP configuration
 * Invalid servers are filtered out with warnings
 */
export function parseMcpConfig(raw: Record<string, unknown>): Pick<LopConfig, "mcpServers" | "mcp"> {
    const result = ConfigSchema.safeParse(raw)

    if (!result.success) {
        console.warn("MCP config validation failed:", result.error.errors)
        return { mcpServers: {}, mcp: {} }
    }

    const mcpServers: Record<string, McpServerConfig> = {}

    if (result.data.mcpServers) {
        for (const [name, serverConfig] of Object.entries(result.data.mcpServers)) {
            const serverResult = McpServerConfigSchema.safeParse(serverConfig)
            if (serverResult.success) {
                mcpServers[name] = serverResult.data
            } else {
                console.warn(`Invalid MCP server config '${name}':`, serverResult.error.errors)
            }
        }
    }

    return {
        mcpServers,
        mcp: result.data.mcp ?? {},
    }
}

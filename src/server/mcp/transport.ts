import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { McpServerConfig } from "../../protocol/types.js"

export type McpTransport = StdioClientTransport | SSEClientTransport | StreamableHTTPClientTransport

/**
 * Create MCP transport based on server configuration
 * Supports stdio, http, and sse transports
 */
export async function createMcpTransport(
    serverName: string,
    cfg: McpServerConfig
): Promise<McpTransport> {
    if (cfg.command) {
        return new StdioClientTransport({
            command: cfg.command,
            args: cfg.args ?? [],
            env: cfg.env,
            cwd: cfg.cwd,
        })
    }

    if (cfg.httpUrl) {
        return new StreamableHTTPClientTransport(
            new URL(cfg.httpUrl),
            { requestInit: { headers: cfg.headers } }
        )
    }

    if (cfg.url) {
        return new SSEClientTransport(
            new URL(cfg.url),
            { requestInit: { headers: cfg.headers } }
        )
    }

    throw new Error(`Invalid MCP server '${serverName}': missing command/httpUrl/url`)
}

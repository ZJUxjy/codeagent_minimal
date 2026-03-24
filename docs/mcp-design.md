# MCP Module Design

This document describes the MCP (Model Context Protocol) module implementation in lop_minimal.

## Architecture

The MCP module follows a layered design inspired by qwen-code:

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolRegistry                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  createDiscoveredMcpTool()                           │  │
│  │  - Wraps MCP tools as standard Tool instances        │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                  McpClientManager                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  - Manages multiple MCP client connections           │  │
│  │  - Handles discovery, reconnection, lifecycle        │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                    McpClient                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  - Single server lifecycle (connect/discover/disconnect)│ │
│  │  - Tool filtering (includeTools/excludeTools)        │  │
│  └──────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                  Transport Layer                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  createMcpTransport()                                │  │
│  │  - stdio: StdioClientTransport                       │  │
│  │  - http: StreamableHTTPClientTransport               │  │
│  │  - sse: SSEClientTransport                           │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Configuration

Add MCP servers to your config file:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "node",
      "args": ["/path/to/filesystem-server.js"],
      "cwd": "/home/user"
    },
    "api-server": {
      "httpUrl": "http://localhost:3000/mcp"
    },
    "legacy-sse": {
      "url": "http://localhost:4000/sse"
    }
  }
}
```

### Server Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `command` | string | Executable command (stdio transport) |
| `args` | string[] | Arguments for command |
| `env` | Record<string, string> | Environment variables |
| `cwd` | string | Working directory |
| `httpUrl` | string | HTTP URL for streamable HTTP transport |
| `url` | string | URL for SSE transport |
| `headers` | Record<string, string> | HTTP headers |
| `timeout` | number | Connection timeout |
| `includeTools` | string[] | Only include these tools |
| `excludeTools` | string[] | Exclude these tools (takes priority) |

## Tool Naming

MCP tools are registered with qualified names:

```
mcp__<server_name>__<tool_name>
```

Example: `mcp__filesystem__read_file`

## Commands

### /mcp list

Show status of all configured MCP servers:

```
MCP Servers:
  • filesystem: connected
  • api-server: error (Connection refused)
```

### /mcp reload

Rediscover MCP tools from all servers:

```
MCP tools reloaded. 2/3 servers connected.
```

## RPC Methods

### mcp_list

Returns server status:

```json
{
  "servers": [
    { "name": "filesystem", "status": "connected" },
    { "name": "api-server", "status": "error", "error": "Connection refused" }
  ]
}
```

### mcp_reload

Reloads all MCP servers and returns updated status.

## Error Handling

- Invalid server configs are filtered out with warnings
- Connection errors are captured per-server
- Tool execution errors return `Error: <message>` format

## Future Enhancements

- OAuth authentication for dynamic registration
- MCP resources support
- Binary data handling
- TUI management panel

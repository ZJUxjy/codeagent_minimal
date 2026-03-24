#!/usr/bin/env node

/**
 * Simple MCP Addition Server for testing
 * Implements a minimal MCP server with an "add" tool
 */

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");

const server = new Server({
  name: "addition-server",
  version: "1.0.0",
}, {
  capabilities: {
    tools: {},
  },
});

// Register the add tool
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add",
        description: "Add two numbers together",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "First number" },
            b: { type: "number", description: "Second number" },
          },
          required: ["a", "b"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "add") {
    const { a, b } = request.params.arguments;
    const result = a + b;
    return {
      content: [{ type: "text", text: String(result) }],
    };
  }
  throw new Error(`Unknown tool: ${request.params.name}`);
});

// Start server with stdio transport
const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error("Addition MCP server running on stdio");
});

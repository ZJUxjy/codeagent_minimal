import { z } from "zod"
import type { Tool } from "./types.js"
import type { McpClient } from "../mcp/client.js"
import { getErrorMessage } from "../../utils/error.js"

/**
 * Create qualified MCP tool name
 * Format: mcp__<server>__<tool>
 */
export function createMcpToolName(server: string, tool: string): string {
    return `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

/**
 * Convert JSON Schema to Zod schema
 * Handles basic types: string, number, integer, boolean, object, array
 */
function jsonSchemaToZod(schema: unknown): z.ZodTypeAny {
    if (!schema || typeof schema !== "object") {
        return z.any()
    }

    const s = schema as Record<string, unknown>

    // Handle array types
    if (s.type === "array") {
        const itemSchema = jsonSchemaToZod(s.items)
        let arr = z.array(itemSchema)
        if (s.minItems !== undefined) arr = arr.min(s.minItems as number)
        if (s.maxItems !== undefined) arr = arr.max(s.maxItems as number)
        return arr
    }

    // Handle object types
    if (s.type === "object" || (!s.type && s.properties)) {
        const properties = (s.properties || {}) as Record<string, unknown>
        const required = (s.required || []) as string[]

        const shape: Record<string, z.ZodTypeAny> = {}

        for (const [key, propSchema] of Object.entries(properties)) {
            let field = jsonSchemaToZod(propSchema)

            // Add description if present
            const prop = propSchema as Record<string, unknown>
            if (prop.description && field instanceof z.ZodType) {
                field = field.describe(prop.description as string)
            }

            // Mark as optional if not required
            if (!required.includes(key)) {
                field = field.optional()
            }

            shape[key] = field
        }

        // Allow additional properties for MCP tools (passthrough)
        return z.object(shape).passthrough()
    }

    // Handle primitive types
    switch (s.type) {
        case "string": {
            let str = z.string()
            if (s.enum && Array.isArray(s.enum)) {
                // @ts-expect-error - zod enum typing
                str = z.enum(s.enum)
            }
            if (s.minLength !== undefined) str = str.min(s.minLength as number)
            if (s.maxLength !== undefined) str = str.max(s.maxLength as number)
            if (s.pattern) str = str.regex(new RegExp(s.pattern as string))
            return str
        }
        case "number":
        case "integer": {
            let num = s.type === "integer" ? z.number().int() : z.number()
            if (s.minimum !== undefined) num = num.min(s.minimum as number)
            if (s.maximum !== undefined) num = num.max(s.maximum as number)
            return num
        }
        case "boolean":
            return z.boolean()
        case "null":
            return z.null()
    }

    // Handle enum without type
    if (s.enum && Array.isArray(s.enum)) {
        // @ts-expect-error - zod enum typing
        return z.enum(s.enum)
    }

    // Handle anyOf/oneOf as union (simplified - just takes first option)
    if (s.anyOf && Array.isArray(s.anyOf) && s.anyOf.length > 0) {
        return jsonSchemaToZod(s.anyOf[0])
    }
    if (s.oneOf && Array.isArray(s.oneOf) && s.oneOf.length > 0) {
        return jsonSchemaToZod(s.oneOf[0])
    }

    // Default fallback
    return z.any()
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

    // Convert JSON Schema to Zod
    const parameters = inputSchema
        ? jsonSchemaToZod(inputSchema)
        : z.object({}).passthrough()

    return {
        name: qualifiedName,
        description: `${description} (${serverName} MCP Server)`,
        parameters,
        async execute(params, _ctx) {
            try {
                const result = await client.callTool(toolName, params)
                return normalizeMcpContent(result)
            } catch (error) {
                return `Error: ${getErrorMessage(error)}`
            }
        },
    }
}

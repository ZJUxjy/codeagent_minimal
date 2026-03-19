import { z } from "zod"
import { readFile } from "fs/promises"
import { existsSync } from "fs"
import type { Tool, ToolContext } from "./types.js"

export const readTool: Tool = {
    name: "read",
    description: `Read a file from the filesystem.
  - Returns the file content with line numbers.
  - Can read any text file including code, config, markdown.
  - For large files, use offset and limit parameters.`,
    parameters: z.object({
        path: z.string().describe("Absolute or relative path to the file"),
        offset: z.number().optional().describe("Starting line number (1-based"),
        limit: z.number().optional().describe("Number of lines to read"),
    }),

    async execute(
        { path, offset = 1, limit }: { path: string; offset?: number; limit?: number },
        ctx: ToolContext
    ): Promise<string> {
        const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

        if (!existsSync(fullPath)) {
            return `Error: File not found: ${fullPath}`
        }

        try {
            const content = await readFile(fullPath, "utf-8")
            const lines = content.split("\n")

            const startLine = Math.max(1, offset) - 1
            const endLine = limit ? startLine + limit : lines.length
            const selectedLines = lines.slice(startLine, endLine)

            const numbered = selectedLines.map((line, i) => `${String(startLine + i + 1).padStart(6)}\t${line}`).join("\n")

            return numbered || "Empty file"
        } catch (error: any) {
            return `Error:${error.message}`
        }
    }
}
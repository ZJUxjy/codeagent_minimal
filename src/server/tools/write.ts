import { z } from "zod"
import { writeFile, mkdir } from "fs/promises"
import { dirname } from "path"
import type { Tool } from "./types.js"

export const writeTool: Tool = {
    name: "write",
    description: `Write content to a file.
- Creates the file if it doesn't exist.
- Overwrites existing content.
- Creates parent directories if needed.`,

    parameters: z.object({
        path: z.string().describe("Path to the file"),
        content: z.string().describe("Content to write"),
    }),

    async execute({ path, content }, ctx) {
        const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

        try {
            // 确保目录存在
            await mkdir(dirname(fullPath), { recursive: true })
            await writeFile(fullPath, content, "utf-8")
            ctx.fileIndex?.onFileChanged(fullPath, content)
            return `Successfully wrote ${content.length} characters to ${fullPath}`
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
}

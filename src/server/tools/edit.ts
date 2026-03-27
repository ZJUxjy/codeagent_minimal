import { z } from "zod"
import { readFile, writeFile } from "fs/promises"
import type { Tool } from "./types.js"

export const editTool: Tool = {
    name: "edit",
    description: `Edit a file by replacing specific text.
- Performs exact string replacement.
- The old_string must match exactly (including whitespace).
- Returns error if old_string is not found or appears multiple times.`,

    parameters: z.object({
        path: z.string().describe("Path to the file"),
        old_string: z.string().describe("Text to replace (must match exactly)"),
        new_string: z.string().describe("Replacement text"),
    }),

    async execute({ path, old_string, new_string }, ctx) {
        const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

        try {
            const content = await readFile(fullPath, "utf-8")

            // 检查唯一性
            const occurrences = content.split(old_string).length - 1
            if (occurrences === 0) {
                return `Error: old_string not found in file`
            }
            if (occurrences > 1) {
                return `Error: old_string appears ${occurrences} times, must be unique`
            }

            const newContent = content.replace(old_string, new_string)
            await writeFile(fullPath, newContent, "utf-8")
            ctx.fileIndex?.onFileChanged(fullPath, newContent)

            return `Successfully edited ${fullPath}`
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
}

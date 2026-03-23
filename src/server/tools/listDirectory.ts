import { z } from "zod"
import { readdir, stat } from "fs/promises"
import { join } from "path"
import type { Tool } from "./types.js"

export const listDirectoryTool: Tool = {
    name: "list_directory",
    description: `List contents of a directory.
- Shows files and subdirectories
- Supports recursive listing
- Can filter with ignore patterns`,

    parameters: z.object({
        path: z.string().optional().describe("Directory path, defaults to current directory"),
        recursive: z.boolean().optional().default(false).describe("List subdirectories recursively"),
        ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
    }),

    async execute({ path, recursive, ignore }, ctx) {
        const dirPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd
        const ignorePatterns = ignore ?? ["node_modules", ".git"]

        async function listDir(dir: string, prefix: string = ""): Promise<string[]> {
            const results: string[] = []

            try {
                const entries = await readdir(dir, { withFileTypes: true })

                for (const entry of entries) {
                    const name = entry.name

                    // 检查是否应忽略
                    if (ignorePatterns.some((p: string) => name === p || name.includes(p))) {
                        continue
                    }

                    const fullPath = join(dir, name)
                    const isDir = entry.isDirectory()
                    const marker = isDir ? "/" : ""
                    results.push(`${prefix}${name}${marker}`)

                    // 递归处理子目录
                    if (recursive && isDir) {
                        const subResults = await listDir(fullPath, `${prefix}  `)
                        results.push(...subResults)
                    }
                }
            } catch (error: any) {
                results.push(`Error reading ${dir}: ${error.message}`)
            }

            return results
        }

        try {
            const stats = await stat(dirPath)
            if (!stats.isDirectory()) {
                return `Error: ${dirPath} is not a directory`
            }

            const items = await listDir(dirPath)

            if (items.length === 0) {
                return `Empty directory: ${dirPath}`
            }

            return items.join("\n")
        } catch (error: any) {
            if (error.code === "ENOENT") {
                return `Error: Directory not found: ${dirPath}`
            }
            if (error.code === "EACCES") {
                return `Error: Permission denied: ${dirPath}`
            }
            return `Error: ${error.message}`
        }
    },
}

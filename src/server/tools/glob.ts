import { z } from "zod"
import fg from "fast-glob"
import type { Tool } from "./types.js"

export const globTool: Tool = {
    name: "glob",
    description: `Find files using glob patterns.
- Supports **, *, ? patterns
- Returns files sorted by modification time
- Use ignore patterns to exclude directories like node_modules`,

    parameters: z.object({
        pattern: z.string().describe("Glob pattern, e.g. '**/*.ts', 'src/**/*.tsx'"),
        path: z.string().optional().describe("Search directory, defaults to current directory"),
        ignore: z.array(z.string()).optional().describe("Patterns to ignore, e.g. ['node_modules', '*.test.ts']"),
    }),

    async execute({ pattern, path, ignore }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        try {
            const files = await fg(pattern, {
                cwd: searchPath,
                ignore: ignore ?? ["node_modules/**", ".git/**"],
                absolute: true,
                onlyFiles: true,
            })

            if (files.length === 0) {
                return `No files found matching pattern: ${pattern}`
            }

            return files.map(f => f as string).join("\n")
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
}

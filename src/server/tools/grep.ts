import { z } from "zod"
import { spawn } from "child_process"
import type { Tool } from "./types.js"

export const grepTool: Tool = {
    name: "grep",
    description: `Search file contents using regex patterns.
- Returns matching lines with file name and line number
- Supports case-insensitive search
- Use glob to filter file types`,

    parameters: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("File or directory to search, defaults to current directory"),
        glob: z.string().optional().describe("File pattern filter, e.g. '*.ts'"),
        ignoreCase: z.boolean().optional().default(false).describe("Case insensitive search"),
        context: z.number().optional().default(0).describe("Number of context lines to show"),
    }),

    async execute({ pattern, path, glob, ignoreCase, context }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        // Build grep arguments
        const args = ["-n"] // Show line numbers
        if (ignoreCase) args.push("-i")
        if (context && context > 0) args.push(`-C${context}`)
        if (glob) args.push("--include", glob)
        args.push("-r") // Recursive search
        args.push("-E") // Extended regex
        args.push("--exclude-dir=node_modules")
        args.push("--exclude-dir=.git")
        args.push(pattern)
        args.push(searchPath)

        return new Promise<string>((resolve) => {
            const proc = spawn("grep", args, {
                cwd: ctx.cwd,
            })

            let stdout = ""
            let stderr = ""

            proc.stdout.on("data", (data) => {
                stdout += data
            })

            proc.stderr.on("data", (data) => {
                stderr += data
            })

            // Set timeout manually since spawn doesn't have timeout option
            const timeout = setTimeout(() => {
                proc.kill()
                resolve(`Error: grep timed out after 30 seconds`)
            }, 30000)

            proc.on("close", (code) => {
                clearTimeout(timeout)
                if (code === 1 && !stdout) {
                    resolve(`No matches found for pattern: ${pattern}`)
                } else if (code !== 0 && !stdout) {
                    resolve(`Error: ${stderr.trim() || `grep exited with code ${code}`}`)
                } else {
                    resolve(stdout.trim() || `No matches found for pattern: ${pattern}`)
                }
            })

            proc.on("error", (error) => {
                clearTimeout(timeout)
                resolve(`Error: ${error.message}`)
            })
        })
    },
}

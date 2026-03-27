import { z } from "zod"
import { spawn } from "child_process"
import type { Tool } from "./types.js"

export const grepTool: Tool = {
    name: "grep",
    description: `Search file contents using regex patterns.
- Returns matching lines with file name and line number
- Supports case-insensitive search
- Use glob to filter file types
- Uses trigram index to accelerate search when available`,

    parameters: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("File or directory to search, defaults to current directory"),
        glob: z.string().optional().describe("File pattern filter, e.g. '*.ts'"),
        ignoreCase: z.boolean().optional().default(false).describe("Case insensitive search"),
        context: z.number().optional().default(0).describe("Number of context lines to show"),
    }),

    async execute({ pattern, path, glob: globPattern, ignoreCase, context }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        const candidates = ctx.fileIndex?.search(pattern) ?? null
        const useIndexedSearch = candidates !== null && candidates.length > 0 && candidates.length < 500

        const args = buildGrepArgs({ pattern, ignoreCase, context, globPattern })

        if (useIndexedSearch) {
            const dirPrefix = searchPath.endsWith('/') ? searchPath : searchPath + '/'
            const filtered = candidates!.filter(f => f.startsWith(dirPrefix))
            if (filtered.length === 0) {
                return `No matches found for pattern: ${pattern}`
            }
            args.push(...filtered)
        } else {
            args.push("-r")
            args.push("--exclude-dir=node_modules")
            args.push("--exclude-dir=.git")
            args.push(searchPath)
        }

        return runGrep(args, ctx.cwd, pattern)
    },
}

function buildGrepArgs(opts: {
    pattern: string
    ignoreCase?: boolean
    context?: number
    globPattern?: string
}): string[] {
    const args = ["-n"]
    if (opts.ignoreCase) args.push("-i")
    if (opts.context && opts.context > 0) args.push(`-C${opts.context}`)
    if (opts.globPattern) args.push("--include", opts.globPattern)
    args.push("-E") // Extended regex
    args.push(opts.pattern)
    return args
}

function runGrep(args: string[], cwd: string, pattern: string): Promise<string> {
    return new Promise<string>((resolve) => {
        const proc = spawn("grep", args, { cwd })

        let stdout = ""
        let stderr = ""

        proc.stdout.on("data", (data) => { stdout += data })
        proc.stderr.on("data", (data) => { stderr += data })

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
}

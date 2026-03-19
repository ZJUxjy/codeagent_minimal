import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "./types.js"

const execAsync = promisify(exec)

export const bashTool: Tool = {
    name: "bash",
    description: `Execute a shell command.
- Use for system operations, running scripts, git commands, etc.
- Commands run in the project directory.
- Avoid interactive commands that require user input.`,

    parameters: z.object({
        command: z.string().describe("The shell command to execute"),
        timeout: z.number().optional().default(30000).describe("Timeout in ms"),
    }),

    async execute({ command, timeout }, ctx) {
        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: ctx.cwd,
                timeout,
                maxBuffer: 10 * 1024 * 1024,
            })

            let result = ""
            if (stdout) result += `STDOUT:\n${stdout}`
            if (stderr) result += `${result ? "\n" : ""}STDERR:\n${stderr}`

            return result || "Command completed with no output"
        } catch (error: any) {
            if (error.killed) {
                return `Error: Command timed out after ${timeout}ms`
            }
            return `Error: ${error.message}\n${error.stderr || ""}`
        }
    },
}

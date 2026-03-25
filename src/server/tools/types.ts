import { z } from "zod"

export interface Tool<T extends z.ZodType = z.ZodType> {
    name: string
    description: string
    parameters: T
    execute: (params: z.infer<T>, ctx: ToolContext) => Promise<string>
}

export interface ToolContext {
    cwd: string
    /** Present during agent.run — propagate to long-running tools (e.g. subagent). */
    signal?: AbortSignal
}


import { z } from "zod"
import type { Question } from "../../protocol/types.js"
import type { AskQuestionResult } from "../questionBridge.js"
import type { FileIndexManager } from "../indexing/fileIndexManager.js"

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
    /** Available when a QuestionBridge is attached to the agent. */
    askQuestion?: (questions: Question[]) => Promise<AskQuestionResult>
    /** Trigram file index for fast regex search. */
    fileIndex?: FileIndexManager
}


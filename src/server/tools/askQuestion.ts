import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const AskQuestionParamsSchema = z.object({
    questions: z.array(z.object({
        id: z.string().describe("Unique identifier for this question"),
        prompt: z.string().describe("The question text to display to the user"),
        options: z.array(z.object({
            label: z.string().describe("Display text for this option"),
            description: z.string().optional().describe("Optional description for this option"),
        })).min(2).max(6).describe("Available choices (2-6 options)"),
        allowMultiple: z.boolean().optional()
            .describe("If true, user can select multiple options"),
    })).min(1).max(4).describe("Questions to ask the user (1-4 questions)"),
})

export const askQuestionTool: Tool = {
    name: "ask_question",
    description: `Ask the user a question with selectable options during execution. Use this to:
- Clarify ambiguous instructions
- Get user preferences or decisions
- Offer implementation choices
Each question must have 2-6 options. Users can always provide custom input via "Other".`,
    parameters: AskQuestionParamsSchema,

    async execute(params, ctx: ToolContext): Promise<string> {
        if (!ctx.askQuestion) {
            return "Error: ask_question is not available in this context"
        }

        const result = await ctx.askQuestion(params.questions)

        if (result.cancelled) {
            return "User declined to answer the questions."
        }

        if (!result.answers || Object.keys(result.answers).length === 0) {
            return "User did not provide any answers."
        }

        const formatted = Object.entries(result.answers)
            .map(([questionId, answer]) => {
                const question = params.questions.find((q: { id: string }) => q.id === questionId)
                const label = question?.prompt ?? `Question ${questionId}`
                return `**${label}**: ${answer}`
            })
            .join("\n")

        return `User answers:\n\n${formatted}`
    },
}

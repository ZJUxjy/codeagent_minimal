import type { LLMClient } from "../../llm.js"
import type { TurnSummary, TurnMeta, SelectionResult } from "./types.js"
import { SELECTION_SYSTEM_PROMPT } from "./prompts.js"

export class ContextSelector {
    private client: LLMClient

    constructor(client: LLMClient) {
        this.client = client
    }

    async select(
        userMessage: string,
        summaries: TurnSummary[],
        turns: TurnMeta[],
        opts?: { skipSelection?: boolean },
    ): Promise<SelectionResult> {
        const allSummaries = summaries.map(s =>
            `### ${s.turnId}\n${s.summary}`
        ).join("\n\n")

        if (opts?.skipSelection) {
            return { fullTurns: [], allSummaries }
        }

        const turnDescriptions = turns.map(t => {
            const prefix = t.isPending ? "[PENDING] " : t.isFailed ? "[FAILED] " : ""
            return `- ${prefix}${t.turnId}`
        }).join("\n")

        const response = await this.client.complete(
            SELECTION_SYSTEM_PROMPT,
            [{ role: "user", content: `## Available Turns\n${turnDescriptions}\n\n## Summaries\n${allSummaries}\n\n## New User Question\n${userMessage}` }],
        )

        let parsed: { fullTurns?: unknown }
        try {
            parsed = JSON.parse(response)
        } catch {
            throw new Error(`ContextSelector: malformed JSON from LLM: ${response.slice(0, 200)}`)
        }

        if (!Array.isArray(parsed.fullTurns)) {
            throw new Error(`ContextSelector: LLM returned non-array fullTurns: ${typeof parsed.fullTurns}`)
        }

        const validTurnIds = new Set(turns.map(t => t.turnId))
        const fullTurns = (parsed.fullTurns as unknown[])
            .filter((id): id is string => typeof id === "string" && validTurnIds.has(id))

        return { fullTurns, allSummaries }
    }
}

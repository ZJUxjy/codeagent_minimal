import { describe, it, expect, vi, beforeEach } from "vitest"
import { ContextSelector } from "./contextSelector.js"
import type { TurnSummary, TurnMeta } from "./types.js"

function createMockClient(completeFn: ReturnType<typeof vi.fn>) {
    return { complete: completeFn } as any
}

describe("ContextSelector", () => {
    let mockComplete: ReturnType<typeof vi.fn>

    beforeEach(() => {
        mockComplete = vi.fn()
    })

    it("skip condition returns all summaries with empty fullTurns", async () => {
        const selector = new ContextSelector(createMockClient(mockComplete))
        const summaries: TurnSummary[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, summary: "s1", createdAt: 1, tokenCount: 10 },
        ]
        const turns: TurnMeta[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, hasSummary: true, isPending: false, isFailed: false },
        ]

        const result = await selector.select("hello", summaries, turns, { skipSelection: true })

        expect(mockComplete).not.toHaveBeenCalled()
        expect(result.fullTurns).toEqual([])
        expect(result.allSummaries).toContain("s1")
    })

    it("LLM returns valid JSON with known turnIds", async () => {
        mockComplete.mockResolvedValue(JSON.stringify({ fullTurns: ["turn-1"] }))

        const selector = new ContextSelector(createMockClient(mockComplete))
        const summaries: TurnSummary[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, summary: "s1", createdAt: 1, tokenCount: 10 },
            { turnId: "turn-2", startMsgId: 4, endMsgId: 5, summary: "s2", createdAt: 2, tokenCount: 10 },
        ]
        const turns: TurnMeta[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, hasSummary: true, isPending: false, isFailed: false },
            { turnId: "turn-2", startMsgId: 4, endMsgId: 5, hasSummary: true, isPending: false, isFailed: false },
        ]

        const result = await selector.select("question about turn 1", summaries, turns)

        expect(result.fullTurns).toEqual(["turn-1"])
        expect(result.allSummaries).toContain("s1")
        expect(result.allSummaries).toContain("s2")
    })

    it("filters unknown turnIds from LLM response", async () => {
        mockComplete.mockResolvedValue(JSON.stringify({ fullTurns: ["turn-1", "turn-unknown"] }))

        const selector = new ContextSelector(createMockClient(mockComplete))
        const summaries: TurnSummary[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, summary: "s1", createdAt: 1, tokenCount: 10 },
        ]
        const turns: TurnMeta[] = [
            { turnId: "turn-1", startMsgId: 1, endMsgId: 3, hasSummary: true, isPending: false, isFailed: false },
        ]

        const result = await selector.select("question", summaries, turns)

        expect(result.fullTurns).toEqual(["turn-1"])
    })

    it("throws on malformed JSON", async () => {
        mockComplete.mockResolvedValue("not valid json {{{")

        const selector = new ContextSelector(createMockClient(mockComplete))
        const summaries: TurnSummary[] = []
        const turns: TurnMeta[] = []

        await expect(selector.select("question", summaries, turns))
            .rejects.toThrow()
    })
})

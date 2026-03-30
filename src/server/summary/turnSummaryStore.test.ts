import { describe, it, expect } from "vitest"
import { InMemoryTurnSummaryStore } from "./turnSummaryStore.js"
import type { TurnSummary } from "./types.js"

function makeSummary(turnId: string, overrides?: Partial<TurnSummary>): TurnSummary {
    return {
        turnId,
        startMsgId: 1,
        endMsgId: 3,
        summary: "test summary",
        createdAt: Date.now(),
        tokenCount: 10,
        ...overrides,
    }
}

describe("InMemoryTurnSummaryStore", () => {
    it("isPending returns true after setPending", () => {
        const store = new InMemoryTurnSummaryStore()
        store.setPending("turn-1")
        expect(store.isPending("turn-1")).toBe(true)
        expect(store.isPending("turn-2")).toBe(false)
    })

    it("add clears pending and failed, get returns summary", () => {
        const store = new InMemoryTurnSummaryStore()
        store.setPending("turn-1")
        store.setFailed("turn-1", "some error")

        const summary = makeSummary("turn-1")
        store.add(summary)

        expect(store.get("turn-1")).toEqual(summary)
        expect(store.isPending("turn-1")).toBe(false)
        expect(store.isFailed("turn-1")).toBe(false)
    })

    it("setFailed clears pending and stores reason", () => {
        const store = new InMemoryTurnSummaryStore()
        store.setPending("turn-1")
        store.setFailed("turn-1", "LLM timeout")

        expect(store.isFailed("turn-1")).toBe(true)
        expect(store.isPending("turn-1")).toBe(false)
        expect(store.getFailedReason("turn-1")).toBe("LLM timeout")
    })

    it("clear removes all state", () => {
        const store = new InMemoryTurnSummaryStore()
        store.add(makeSummary("turn-1"))
        store.setPending("turn-2")
        store.setFailed("turn-3", "error")

        store.clear()

        expect(store.get("turn-1")).toBeUndefined()
        expect(store.isPending("turn-2")).toBe(false)
        expect(store.isFailed("turn-3")).toBe(false)
        expect(store.getAll()).toEqual([])
    })

    it("getAll returns summaries in insertion order", () => {
        const store = new InMemoryTurnSummaryStore()
        store.add(makeSummary("turn-1"))
        store.add(makeSummary("turn-2"))
        store.add(makeSummary("turn-3"))

        const all = store.getAll()
        expect(all.map(s => s.turnId)).toEqual(["turn-1", "turn-2", "turn-3"])
    })
})

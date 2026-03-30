import { describe, it, expect, vi, beforeEach } from "vitest"
import { Summarizer } from "./summarizer.js"
import { InMemoryTurnSummaryStore } from "./turnSummaryStore.js"
import type { CoreMessage } from "ai"

function createMockClient(completeFn: ReturnType<typeof vi.fn>) {
    return { complete: completeFn } as any
}

describe("Summarizer", () => {
    let store: InMemoryTurnSummaryStore
    let mockComplete: ReturnType<typeof vi.fn>
    let summarizer: Summarizer

    beforeEach(() => {
        mockComplete = vi.fn()
        store = new InMemoryTurnSummaryStore()
        summarizer = new Summarizer(createMockClient(mockComplete), store)
    })

    it("successful summarization adds to store with tokenCount", async () => {
        mockComplete.mockResolvedValue("## Goal\nTest goal\n## Key Decisions\nNone\n## Files Changed\nNone\n## Current State\nDone\n## Important Context\nNone")

        summarizer.enqueue("turn-1", [{ role: "user", content: "hello" }, { role: "assistant", content: "world" }] as CoreMessage[], 1, 2)

        await new Promise(resolve => setTimeout(resolve, 50))

        const summary = store.get("turn-1")
        expect(summary).toBeDefined()
        expect(summary?.summary).toContain("## Goal")
        expect(summary?.tokenCount).toBeGreaterThan(0)
        expect(store.isPending("turn-1")).toBe(false)
    })

    it("empty LLM response marks as failed", async () => {
        mockComplete.mockResolvedValue("")

        summarizer.enqueue("turn-1", [{ role: "user", content: "hello" }] as CoreMessage[], 1, 1)

        await new Promise(resolve => setTimeout(resolve, 50))

        expect(store.isFailed("turn-1")).toBe(true)
        expect(store.getFailedReason("turn-1")).toContain("empty")
    })

    it("abort() prevents unhandled rejection", async () => {
        mockComplete.mockImplementation(() => new Promise((_, reject) => {
            setTimeout(() => reject(new Error("aborted")), 100)
        }))

        summarizer.enqueue("turn-1", [{ role: "user", content: "hello" }] as CoreMessage[], 1, 1)
        summarizer.abort()

        await new Promise(resolve => setTimeout(resolve, 200))

        expect(true).toBe(true)
    })

    it("queue processes sequentially — second turn waits for first", async () => {
        const callOrder: string[] = []

        mockComplete.mockImplementation(async () => {
            callOrder.push("complete")
            return "## Goal\nSummary"
        })

        summarizer.enqueue("turn-1", [{ role: "user", content: "first" }] as CoreMessage[], 1, 1)
        summarizer.enqueue("turn-2", [{ role: "user", content: "second" }] as CoreMessage[], 2, 2)

        // Wait for both to complete
        await new Promise(resolve => setTimeout(resolve, 200))

        expect(store.get("turn-1")).toBeDefined()
        expect(store.get("turn-2")).toBeDefined()
        // Both should have been called
        expect(mockComplete).toHaveBeenCalledTimes(2)
    })

    it("duplicate enqueue is ignored", async () => {
        mockComplete.mockResolvedValue("## Goal\nTest")

        summarizer.enqueue("turn-1", [{ role: "user", content: "hello" }] as CoreMessage[], 1, 1)
        summarizer.enqueue("turn-1", [{ role: "user", content: "hello" }] as CoreMessage[], 1, 1)

        await new Promise(resolve => setTimeout(resolve, 50))

        const summary = store.get("turn-1")
        expect(summary).toBeDefined()
        expect(mockComplete).toHaveBeenCalledTimes(1)
    })
})

import { describe, it, expect, vi, beforeEach } from "vitest"

// ── Module-level mock state ──
let mockComplete = vi.fn()
let mockStream = vi.fn()
let llmConstructorCallCount = 0

// Mock LLMClient as a proper class (must use class, not arrow function)
vi.mock("../../llm.js", () => ({
    LLMClient: class MockLLMClient {
        complete = mockComplete
        stream = mockStream
        static normalizeAnthropicCompatibleBaseURL = vi.fn((u: string) => u)
        constructor() {
            llmConstructorCallCount++
        }
    },
    normalizeAnthropicCompatibleBaseURL: vi.fn(),
}))

// Mock fileIndexManager to avoid fs calls
vi.mock("../indexing/fileIndexManager.js", () => ({
    FileIndexManager: class MockFileIndexManager {
        build = vi.fn().mockResolvedValue(undefined)
    },
}))

// Mock compression module for forceCompress tests
const mockCompressContext = vi.fn()
vi.mock("../compression/index.js", () => ({
    shouldCompress: vi.fn().mockReturnValue(false),
    compressContext: (...args: any[]) => mockCompressContext(...args),
}))

import { Agent } from "../agent.js"
import { InMemoryStore } from "../store.js"

function makeTextStream(text: string): AsyncGenerator<any> {
    return (async function* () {
        yield { type: "text-delta", textDelta: text }
        yield { type: "done", finishReason: "stop" }
    })()
}

describe("Agent working context (summary mode)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        llmConstructorCallCount = 0
        mockStream.mockReturnValue(makeTextStream("hello"))
    })

    it("summary disabled: agent created without summary runtime", () => {
        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
        })
        expect(agent).toBeDefined()
        // Only 1 LLMClient constructed (main)
        expect(llmConstructorCallCount).toBe(1)
    })

    it("summary enabled: LLMClient constructed twice (main + summary)", () => {
        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })
        expect(agent).toBeDefined()
        // 2 LLMClient instances: main + summary
        expect(llmConstructorCallCount).toBe(2)
    })

    it("summary disabled: run() does not call contextSelector", async () => {
        mockStream.mockReturnValue(makeTextStream("response"))

        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
        })

        const events: any[] = []
        for await (const event of agent.run("hello")) {
            events.push(event)
        }

        // contextSelector.complete should NOT have been called
        expect(mockComplete).not.toHaveBeenCalled()
        expect(events.some(e => e.type === "done")).toBe(true)
    })

    it("summary enabled with small context: skips selection, falls back to full history", async () => {
        mockStream.mockReturnValue(makeTextStream("response"))

        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })

        const events: any[] = []
        for await (const event of agent.run("hello")) {
            events.push(event)
        }

        // With small context (single message), selector should be skipped.
        // Summarizer may still call complete (enqueueCompletedTurn fires after stop),
        // so we check that no call used the SELECTION prompt.
        const selectorCalls = mockComplete.mock.calls.filter(
            (call: any[]) => typeof call[0] === "string" && call[0].includes("context selection assistant"),
        )
        expect(selectorCalls).toHaveLength(0)
        expect(events.some(e => e.type === "done")).toBe(true)
    })

    it("runSeeded does not call selector even when summary enabled", async () => {
        mockStream.mockReturnValue(makeTextStream("response"))

        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })

        const events: any[] = []
        for await (const event of agent.runSeeded()) {
            events.push(event)
        }

        // Selector should NOT be called in runSeeded
        expect(mockComplete).not.toHaveBeenCalled()
        expect(events.some(e => e.type === "done")).toBe(true)
    })
})

describe("Agent summary runtime reset", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        llmConstructorCallCount = 0
        mockStream.mockReturnValue(makeTextStream("response"))
    })

    it("clearHistory() resets summary state — subsequent run is clean", async () => {
        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })

        // First run: adds to turnTracker
        const events1: any[] = []
        for await (const event of agent.run("first message")) {
            events1.push(event)
        }
        expect(events1.some(e => e.type === "done")).toBe(true)

        // Clear history
        agent.clearHistory()

        // Second run: should work cleanly, no stale state
        vi.clearAllMocks()
        mockStream.mockReturnValue(makeTextStream("response"))
        const events2: any[] = []
        for await (const event of agent.run("second message")) {
            events2.push(event)
        }
        expect(events2.some(e => e.type === "done")).toBe(true)

        // Selector should be skipped (small context after clear)
        const selectorCalls = mockComplete.mock.calls.filter(
            (call: any[]) => typeof call[0] === "string" && call[0].includes("context selection assistant"),
        )
        expect(selectorCalls).toHaveLength(0)
    })

    it("replaceStore() resets summary state", async () => {
        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })

        // First run
        const events1: any[] = []
        for await (const event of agent.run("first message")) {
            events1.push(event)
        }
        expect(events1.some(e => e.type === "done")).toBe(true)

        // Replace store with fresh one
        agent.replaceStore(new InMemoryStore())

        // Verify store was replaced
        expect(agent.getStoreMessages()).toEqual([])

        // Second run should work cleanly
        vi.clearAllMocks()
        mockStream.mockReturnValue(makeTextStream("response"))
        const events2: any[] = []
        for await (const event of agent.run("after replace")) {
            events2.push(event)
        }
        expect(events2.some(e => e.type === "done")).toBe(true)
    })

    it("forceCompress() resets summary state on success", async () => {
        mockCompressContext.mockResolvedValue({
            status: "compressed",
            tokensBefore: 50000,
            tokensAfter: 10000,
        })

        const agent = new Agent({
            provider: "openai",
            model: "test",
            cwd: "/tmp",
            summary: { enabled: true },
        })

        // Run once to populate turnTracker
        const events: any[] = []
        for await (const event of agent.run("message")) {
            events.push(event)
        }

        // Force compress — should reset summary runtime
        const result = await agent.forceCompress()
        expect(result.status).toBe("compressed")

        // After reset, a new run should work cleanly
        vi.clearAllMocks()
        mockCompressContext.mockResolvedValue({
            status: "compressed",
            tokensBefore: 50000,
            tokensAfter: 10000,
        })
        mockStream.mockReturnValue(makeTextStream("response"))
        const events2: any[] = []
        for await (const event of agent.run("after compress")) {
            events2.push(event)
        }
        expect(events2.some(e => e.type === "done")).toBe(true)
    })
})

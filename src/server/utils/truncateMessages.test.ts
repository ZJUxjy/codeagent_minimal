import { describe, it, expect } from "vitest"
import { truncateMessages } from "./truncateMessages.js"
import type { CoreMessage } from "ai"

const user = (content: string): CoreMessage => ({ role: "user", content })
const assistant = (content: string): CoreMessage => ({ role: "assistant", content })
const toolResult = (id: string): CoreMessage => ({
    role: "tool",
    content: [{ type: "tool-result", toolCallId: id, toolName: "bash", result: "ok" }],
} as CoreMessage)

describe("truncateMessages", () => {
    it("returns messages unchanged when under budget", () => {
        const msgs = [user("hi"), assistant("hello")]
        expect(truncateMessages(msgs, 10_000)).toEqual(msgs)
    })

    it("returns empty array unchanged", () => {
        expect(truncateMessages([], 100)).toEqual([])
    })

    it("always keeps the first message", () => {
        // 100 chars * 2 messages = 200 chars ≈ 57 tokens, budget = 20 forces truncation
        const first = user("x".repeat(100))
        const msgs = [first, assistant("y".repeat(100))]
        const result = truncateMessages(msgs, 20)
        expect(result[0]).toEqual(first)
    })

    it("drops oldest turns first", () => {
        const msgs = [
            user("task"),
            assistant("turn1"),
            assistant("turn2"),
            assistant("turn3 " + "x".repeat(500)),
        ]
        // Budget tight enough to force dropping turn1 but not turn3
        const result = truncateMessages(msgs, 50)
        expect(result.some(m => m.content === "turn1")).toBe(false)
        expect(result.some(m => typeof m.content === "string" && m.content.startsWith("turn3"))).toBe(true)
    })

    it("keeps tool results with their assistant message", () => {
        const msgs = [
            user("task"),
            assistant("turn1"),
            toolResult("call-1"),
            assistant("turn2 " + "x".repeat(500)),
            toolResult("call-2"),
        ]
        // Force truncation of the first turn
        const result = truncateMessages(msgs, 60)
        // turn1 and its tool result should be dropped together or kept together
        const hasTurn1 = result.some(m => m.content === "turn1")
        const hasResult1 = result.some(m =>
            Array.isArray(m.content) &&
            (m.content as any[]).some((p: any) => p.toolCallId === "call-1")
        )
        expect(hasTurn1).toBe(hasResult1)
    })

    it("never drops below first message + last turn", () => {
        // Even with a tiny budget, we keep at least first + last turn
        const msgs = [user("task"), assistant("only turn")]
        const result = truncateMessages(msgs, 1)
        expect(result).toHaveLength(2)
    })
})

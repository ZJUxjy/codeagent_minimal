import { describe, it, expect } from "vitest"
import { TurnTracker } from "./turnTracker.js"
import type { CoreMessage } from "ai"

describe("TurnTracker", () => {
    const messages: CoreMessage[] = [
        { role: "user", content: "A" },
        { role: "assistant", content: "B" },
        { role: "tool", content: [{ type: "tool-result", toolCallId: "1", toolName: "read", result: "ok" }] as any },
        { role: "user", content: "C" },
    ]

    it("first user message starts a turn", () => {
        const tracker = new TurnTracker()
        tracker.observe(messages.slice(0, 1))

        const turns = tracker.getTurns()
        expect(turns).toHaveLength(1)
        expect(turns[0].startMsgId).toBe(1)
    })

    it("assistant and tool messages extend the same turn", () => {
        const tracker = new TurnTracker()
        tracker.observe(messages.slice(0, 3))

        const turns = tracker.getTurns()
        expect(turns).toHaveLength(1)
        expect(turns[0].endMsgId).toBe(3)
    })

    it("new user message starts a new turn", () => {
        const tracker = new TurnTracker()
        tracker.observe(messages)

        const turns = tracker.getTurns()
        expect(turns).toHaveLength(2)
        expect(turns[0].endMsgId).toBe(3)
        expect(turns[1].startMsgId).toBe(4)
        expect(turns[1].turnId).not.toBe(turns[0].turnId)
    })

    it("reset clears all state and resets nextId to 1", () => {
        const tracker = new TurnTracker()
        tracker.observe(messages)
        expect(tracker.getTurns()).toHaveLength(2)

        tracker.reset()

        expect(tracker.getTurns()).toHaveLength(0)

        // New observation should start messageId from 1 again
        tracker.observe(messages.slice(0, 1))
        const turns = tracker.getTurns()
        expect(turns).toHaveLength(1)
        expect(turns[0].startMsgId).toBe(1)
    })

    it("observe is incremental — only processes new messages", () => {
        const tracker = new TurnTracker()
        // First observe: only user + assistant
        tracker.observe(messages.slice(0, 2))
        expect(tracker.getTurns()).toHaveLength(1)

        // Second observe: full array — should process the 2 new messages (tool, user)
        // Note: messageIdToIndex maps to positions in the *current* call's array
        tracker.observe(messages)

        const turns = tracker.getTurns()
        expect(turns).toHaveLength(2)
        // First turn should now include the tool message
        expect(turns[0].endMsgId).toBe(3)
        // Second turn starts at the second user message
        expect(turns[1].startMsgId).toBe(4)
    })

    it("getMessagesForTurn returns correct slice", () => {
        const tracker = new TurnTracker()
        tracker.observe(messages)

        const turn0Messages = tracker.getMessagesForTurn(tracker.getTurns()[0].turnId, messages)
        expect(turn0Messages).toHaveLength(3)
        expect(turn0Messages[0].role).toBe("user")
        expect(turn0Messages[0].content).toBe("A")

        const turn1Messages = tracker.getMessagesForTurn(tracker.getTurns()[1].turnId, messages)
        expect(turn1Messages).toHaveLength(1)
        expect(turn1Messages[0].content).toBe("C")
    })
})

import type { CoreMessage } from "ai"
import type { TrackedTurnBoundary } from "./types.js"

export class TurnTracker {
    private turnCounter = 0
    private nextMessageId = 1
    private messageIdToIndex = new Map<number, number>()
    private turns: TrackedTurnBoundary[] = []
    private turnIndex = new Map<string, TrackedTurnBoundary>()
    private lastObservedLength = 0
    private currentTurnId: string | null = null

    observe(messages: CoreMessage[]): void {
        const start = this.lastObservedLength
        if (start >= messages.length) return

        for (let i = start; i < messages.length; i++) {
            const msg = messages[i]
            const msgId = this.nextMessageId++
            this.messageIdToIndex.set(msgId, i)

            if (msg.role === "user") {
                // Close previous turn
                if (this.currentTurnId !== null) {
                    const prev = this.turnIndex.get(this.currentTurnId)
                    if (prev) prev.endMsgId = msgId - 1
                }
                // Start new turn
                const turnId = `turn-${++this.turnCounter}`
                this.currentTurnId = turnId
                const boundary: TrackedTurnBoundary = { turnId, startMsgId: msgId, endMsgId: msgId }
                this.turns.push(boundary)
                this.turnIndex.set(turnId, boundary)
            } else {
                // Extend current turn
                if (this.currentTurnId !== null) {
                    const current = this.turnIndex.get(this.currentTurnId)
                    if (current) current.endMsgId = msgId
                }
            }
        }

        this.lastObservedLength = messages.length
    }

    getTurns(): TrackedTurnBoundary[] {
        return [...this.turns]
    }

    getMessagesForTurn(turnId: string, messages: CoreMessage[]): CoreMessage[] {
        const turn = this.turnIndex.get(turnId)
        if (!turn) return []

        const startIdx = this.messageIdToIndex.get(turn.startMsgId)
        const endIdx = this.messageIdToIndex.get(turn.endMsgId)
        if (startIdx === undefined || endIdx === undefined) return []

        return messages.slice(startIdx, endIdx + 1)
    }

    reset(): void {
        this.turnCounter = 0
        this.nextMessageId = 1
        this.messageIdToIndex.clear()
        this.turns = []
        this.turnIndex.clear()
        this.lastObservedLength = 0
        this.currentTurnId = null
    }
}

import type { CoreMessage } from "ai"
import type { TrackedTurnBoundary } from "./types.js"

export class TurnTracker {
    private turnCounter = 0
    private nextMessageId = 1
    private messageIdToIndex = new Map<number, number>()
    private turns: TrackedTurnBoundary[] = []
    private lastObservedLength = 0
    private currentTurnStartMsgId: number | null = null
    private currentTurnId: string | null = null

    observe(messages: CoreMessage[]): void {
        const start = this.lastObservedLength
        if (start >= messages.length) return

        for (let i = start; i < messages.length; i++) {
            const msg = messages[i]
            const msgId = this.nextMessageId++
            this.messageIdToIndex.set(msgId, i)

            if (msg.role === "user") {
                // Close previous turn if any
                if (this.currentTurnId !== null && this.currentTurnStartMsgId !== null) {
                    const prevIdx = this.turns.findIndex(t => t.turnId === this.currentTurnId)
                    if (prevIdx !== -1) {
                        this.turns[prevIdx].endMsgId = msgId - 1
                    }
                }
                // Start new turn
                const turnId = `turn-${++this.turnCounter}`
                this.currentTurnId = turnId
                this.currentTurnStartMsgId = msgId
                this.turns.push({ turnId, startMsgId: msgId, endMsgId: msgId })
            } else {
                // Extend current turn
                if (this.currentTurnId !== null) {
                    const currentTurn = this.turns[this.turns.length - 1]
                    if (currentTurn) {
                        currentTurn.endMsgId = msgId
                    }
                }
            }
        }

        this.lastObservedLength = messages.length
    }

    getTurns(): TrackedTurnBoundary[] {
        return [...this.turns]
    }

    getMessagesForTurn(turnId: string, messages: CoreMessage[]): CoreMessage[] {
        const turn = this.turns.find(t => t.turnId === turnId)
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
        this.lastObservedLength = 0
        this.currentTurnStartMsgId = null
        this.currentTurnId = null
    }
}

/** Per-turn summary produced by the Summarizer */
export interface TurnSummary {
    turnId: string
    startMsgId: number
    endMsgId: number
    summary: string
    createdAt: number
    tokenCount: number
}

/** Metadata for a turn, derived from TurnTracker + TurnSummaryStore */
export interface TurnMeta {
    turnId: string
    startMsgId: number
    endMsgId: number
    hasSummary: boolean
    isPending: boolean
    isFailed: boolean
}

/** Result of context selection */
export interface SelectionResult {
    fullTurns: string[]
    allSummaries: string
}

/** Internal turn boundary tracked by TurnTracker */
export interface TrackedTurnBoundary {
    turnId: string
    startMsgId: number
    endMsgId: number
}

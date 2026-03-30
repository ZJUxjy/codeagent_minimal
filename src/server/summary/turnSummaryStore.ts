import type { TurnSummary } from "./types.js"

export interface TurnSummaryStore {
    add(summary: TurnSummary): void
    get(turnId: string): TurnSummary | undefined
    getAll(): TurnSummary[]
    getFailedReason(turnId: string): string | undefined
    setPending(turnId: string): void
    isPending(turnId: string): boolean
    setFailed(turnId: string, reason: string): void
    isFailed(turnId: string): boolean
    clear(): void
}

export class InMemoryTurnSummaryStore implements TurnSummaryStore {
    private summaries = new Map<string, TurnSummary>()
    private pending = new Set<string>()
    private failedReasons = new Map<string, string>()

    add(summary: TurnSummary): void {
        this.pending.delete(summary.turnId)
        this.failedReasons.delete(summary.turnId)
        this.summaries.set(summary.turnId, summary)
    }

    get(turnId: string): TurnSummary | undefined {
        return this.summaries.get(turnId)
    }

    getAll(): TurnSummary[] {
        return Array.from(this.summaries.values())
    }

    getFailedReason(turnId: string): string | undefined {
        return this.failedReasons.get(turnId)
    }

    setPending(turnId: string): void {
        if (this.summaries.has(turnId)) return // already summarized
        this.pending.add(turnId)
    }

    isPending(turnId: string): boolean {
        return this.pending.has(turnId)
    }

    setFailed(turnId: string, reason: string): void {
        this.pending.delete(turnId)
        this.failedReasons.set(turnId, reason)
    }

    isFailed(turnId: string): boolean {
        return this.failedReasons.has(turnId)
    }

    clear(): void {
        this.summaries.clear()
        this.pending.clear()
        this.failedReasons.clear()
    }
}

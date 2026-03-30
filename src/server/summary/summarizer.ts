import type { CoreMessage } from "ai"
import type { LLMClient } from "../../llm.js"
import type { TurnSummaryStore } from "./turnSummaryStore.js"
import { SUMMARY_SYSTEM_PROMPT } from "./prompts.js"

interface QueueItem {
    turnId: string
    messages: CoreMessage[]
}

export class Summarizer {
    private client: LLMClient
    private store: TurnSummaryStore
    private queue: QueueItem[] = []
    private processing = false
    private activeAbortController: AbortController | null = null
    private pendingOrSummarized = new Set<string>()

    constructor(client: LLMClient, store: TurnSummaryStore) {
        this.client = client
        this.store = store
    }

    enqueue(turnId: string, messages: CoreMessage[]): void {
        if (this.pendingOrSummarized.has(turnId)) return

        this.pendingOrSummarized.add(turnId)
        this.store.setPending(turnId)
        this.queue.push({ turnId, messages })
        this.processQueue().catch(() => {})
    }

    abort(): void {
        this.activeAbortController?.abort()
        this.activeAbortController = null
        // Mark queued items as failed so orphan pending state is cleared
        for (const item of this.queue) {
            this.store.setFailed(item.turnId, "aborted")
        }
        this.queue = []
        this.pendingOrSummarized.clear()
        this.processing = false
    }

    private async processQueue(): Promise<void> {
        if (this.processing) return
        this.processing = true

        while (this.queue.length > 0) {
            const item = this.queue.shift()!
            await this.processItem(item)
        }

        this.processing = false
    }

    private async processItem(item: QueueItem): Promise<void> {
        const controller = new AbortController()
        this.activeAbortController = controller

        try {
            const summary = await this.client.complete(
                SUMMARY_SYSTEM_PROMPT,
                item.messages,
                controller.signal,
            )

            if (!summary?.trim()) {
                this.store.setFailed(item.turnId, "empty summary from LLM")
                return
            }

            const turnSummary: import("./types.js").TurnSummary = {
                turnId: item.turnId,
                startMsgId: 0, // filled by caller
                endMsgId: 0,
                summary: summary.trim(),
                createdAt: Date.now(),
                tokenCount: Math.ceil(summary.length / 3.5),
            }

            this.store.add(turnSummary)
        } catch (error: any) {
            if (controller.signal.aborted) {
                this.store.setFailed(item.turnId, "aborted")
            } else {
                this.store.setFailed(item.turnId, error.message ?? "unknown error")
            }
        } finally {
            this.activeAbortController = null
        }
    }
}

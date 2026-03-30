import type { CoreMessage } from "ai"
import type { LLMClient } from "../../llm.js"
import { CHARS_PER_TOKEN } from "../utils/truncateMessages.js"
import { COMPRESSION_SYSTEM_PROMPT } from "../compression/prompt.js"
import type { TurnSummaryStore } from "./turnSummaryStore.js"
import type { TurnSummary } from "./types.js"

interface QueueItem {
    turnId: string
    messages: CoreMessage[]
    startMsgId: number
    endMsgId: number
}

export class Summarizer {
    private client: LLMClient
    private store: TurnSummaryStore
    private queue: QueueItem[] = []
    private processing = false
    private activeAbortController: AbortController | null = null

    constructor(client: LLMClient, store: TurnSummaryStore) {
        this.client = client
        this.store = store
    }

    enqueue(turnId: string, messages: CoreMessage[], startMsgId: number, endMsgId: number): void {
        if (this.store.isPending(turnId) || this.store.get(turnId)) return

        this.store.setPending(turnId)
        this.queue.push({ turnId, messages, startMsgId, endMsgId })
        this.processQueue().catch(() => {})
    }

    abort(): void {
        this.activeAbortController?.abort()
        this.activeAbortController = null
        for (const item of this.queue) {
            this.store.setFailed(item.turnId, "aborted")
        }
        this.queue = []
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
                COMPRESSION_SYSTEM_PROMPT,
                item.messages,
                controller.signal,
            )

            if (!summary?.trim()) {
                this.store.setFailed(item.turnId, "empty summary from LLM")
                return
            }

            const turnSummary: TurnSummary = {
                turnId: item.turnId,
                startMsgId: item.startMsgId,
                endMsgId: item.endMsgId,
                summary: summary.trim(),
                createdAt: Date.now(),
                tokenCount: Math.ceil(summary.length / CHARS_PER_TOKEN),
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

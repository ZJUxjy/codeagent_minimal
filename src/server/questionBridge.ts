import type { Question, AskQuestionResponseParams } from "../protocol/types.js"

export interface AskQuestionResult {
    answers?: Record<string, string>
    cancelled: boolean
}

type SendNotificationFn = (method: string, params: unknown) => void

export class QuestionBridge {
    private pending = new Map<string, {
        resolve: (result: AskQuestionResult) => void
    }>()
    private counter = 0

    constructor(private sendNotification: SendNotificationFn) {}

    async ask(questions: Question[], signal?: AbortSignal): Promise<AskQuestionResult> {
        const requestId = `ask_${++this.counter}_${Date.now()}`

        if (signal?.aborted) {
            return { cancelled: true }
        }

        return new Promise<AskQuestionResult>((resolve) => {
            const onAbort = () => {
                this.pending.delete(requestId)
                resolve({ cancelled: true })
            }

            signal?.addEventListener("abort", onAbort, { once: true })

            this.pending.set(requestId, { resolve: (result) => {
                signal?.removeEventListener("abort", onAbort)
                resolve(result)
            }})

            this.sendNotification("ask_question", { requestId, questions })
        })
    }

    handleResponse(params: AskQuestionResponseParams): boolean {
        const entry = this.pending.get(params.requestId)
        if (!entry) return false

        this.pending.delete(params.requestId)
        entry.resolve({
            answers: params.answers,
            cancelled: params.cancelled ?? false,
        })
        return true
    }

    cancelAll(): void {
        for (const [, entry] of this.pending) {
            entry.resolve({ cancelled: true })
        }
        this.pending.clear()
    }
}

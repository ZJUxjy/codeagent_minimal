import type { Question, AskQuestionResponseParams, PermissionOutcome, PermissionResponseParams } from "../protocol/types.js"

export interface AskQuestionResult {
    answers?: Record<string, string>
    cancelled: boolean
}

type SendNotificationFn = (method: string, params: unknown) => void

const PERMISSION_TIMEOUT_MS = 60_000

export class QuestionBridge {
    private pending = new Map<string, {
        resolve: (result: AskQuestionResult) => void
    }>()
    private pendingPermissions = new Map<string, {
        resolve: (outcome: PermissionOutcome) => void
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

    /** Pause the agent loop and prompt the user for a permission decision. */
    async askPermission(
        toolName: string,
        summary: string,
        signal?: AbortSignal,
    ): Promise<PermissionOutcome> {
        const requestId = `perm_${++this.counter}_${Date.now()}`

        if (signal?.aborted) return "deny"

        return new Promise<PermissionOutcome>((resolve) => {
            let timer: ReturnType<typeof setTimeout> | undefined

            const finish = (outcome: PermissionOutcome) => {
                clearTimeout(timer)
                signal?.removeEventListener("abort", onAbort)
                this.pendingPermissions.delete(requestId)
                resolve(outcome)
            }

            const onAbort = () => finish("deny")
            signal?.addEventListener("abort", onAbort, { once: true })

            // Auto-deny after timeout to prevent hanging forever
            timer = setTimeout(() => finish("deny"), PERMISSION_TIMEOUT_MS)

            this.pendingPermissions.set(requestId, { resolve: finish })
            this.sendNotification("permission_request", { requestId, toolName, summary })
        })
    }

    handlePermissionResponse(params: PermissionResponseParams): boolean {
        const entry = this.pendingPermissions.get(params.requestId)
        if (!entry) return false
        entry.resolve(params.outcome)
        return true
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
        for (const [, entry] of this.pendingPermissions) {
            entry.resolve("deny")
        }
        this.pendingPermissions.clear()
    }
}

import type { CoreMessage } from "ai"
import type { MessageStore } from "../store.js"
import type { LLMClient } from "../../llm.js"
import { estimateTokens, estimateTotalTokens, DEFAULT_MAX_TOKENS } from "../utils/truncateMessages.js"
import { COMPRESSION_SYSTEM_PROMPT } from "./prompt.js"

const COMPRESSION_THRESHOLD = 0.75  // compress when estimated tokens > 75% of limit
const PRESERVE_TAIL_RATIO   = 0.30  // keep last 30% of messages uncompressed

export type CompressionStatus =
    | "compressed"
    | "noop"
    | "failed_empty"
    | "failed_inflated"

export interface CompressionResult {
    status: CompressionStatus
    tokensBefore?: number
    tokensAfter?: number
}

export interface CompressionOptions {
    disabled?: boolean
    failedLastAttempt?: boolean
    tokenLimit?: number
}

function hasToolCalls(msg: CoreMessage): boolean {
    if (typeof msg.content !== "string") {
        return Array.isArray(msg.content) && msg.content.some((p: any) => p.type === "tool-call")
    }
    return false
}

export function shouldCompress(messages: CoreMessage[], opts: CompressionOptions): boolean {
    if (opts.disabled) return false
    if (opts.failedLastAttempt) return false
    const estimated = estimateTotalTokens(messages)
    const limit = opts.tokenLimit ?? DEFAULT_MAX_TOKENS
    return estimated / limit >= COMPRESSION_THRESHOLD
}

/**
 * Returns true when `idx` is a natural task boundary:
 * - messages[idx] is a user message (new task begins)
 * - messages[idx - 1] is an assistant message with no pending tool calls (previous task complete)
 */
function isTaskBoundary(messages: CoreMessage[], idx: number): boolean {
    if (idx <= 0 || idx >= messages.length) return false
    const curr = messages[idx]
    const prev = messages[idx - 1]
    return curr.role === "user" && prev.role === "assistant" && !hasToolCalls(prev)
}

function findSemanticSplitPoint(messages: CoreMessage[], tailBudget: number): number {
    // Collect all natural task boundary indices
    const boundaries: number[] = []
    for (let i = 1; i < messages.length; i++) {
        if (isTaskBoundary(messages, i)) boundaries.push(i)
    }
    if (boundaries.length === 0) return 0

    // Iterate backwards: find earliest boundary whose tail >= tailBudget
    let tailTokens = 0
    let best = boundaries[boundaries.length - 1]  // fallback: latest boundary

    for (let b = boundaries.length - 1; b >= 0; b--) {
        const boundaryIdx = boundaries[b]
        // Add tokens for messages from boundaryIdx up to the previous boundary (or end)
        const nextBoundary = boundaries[b + 1] ?? messages.length
        for (let i = boundaryIdx; i < nextBoundary; i++) {
            tailTokens += estimateTokens(messages[i])
        }
        best = boundaryIdx
        if (tailTokens >= tailBudget) break
    }

    return best
}

function findSplitPoint(messages: CoreMessage[]): number {
    const total = estimateTotalTokens(messages)
    const tailBudget = total * PRESERVE_TAIL_RATIO

    const semantic = findSemanticSplitPoint(messages, tailBudget)
    if (semantic > 0) return semantic

    // Fallback: mechanical split — first safe user message after crossing 70% mark
    const target = total * (1 - PRESERVE_TAIL_RATIO)
    let accumulated = 0
    for (let i = 0; i < messages.length; i++) {
        accumulated += estimateTokens(messages[i])
        if (messages[i].role === "user" && accumulated >= target) {
            const prev = messages[i - 1]
            if (prev && hasToolCalls(prev)) continue
            return i
        }
    }
    return 0
}

export async function compressContext(
    store: MessageStore,
    llm: LLMClient,
    signal?: AbortSignal,
): Promise<CompressionResult> {
    const messages = store.getAll()
    const splitIdx = findSplitPoint(messages)
    if (splitIdx === 0) return { status: "noop" }

    const toCompress = messages.slice(0, splitIdx)
    const tail       = messages.slice(splitIdx)

    const summary = await llm.complete(COMPRESSION_SYSTEM_PROMPT, toCompress, signal)
    if (!summary?.trim()) return { status: "failed_empty" }

    const compressed: CoreMessage[] = [
        { role: "user",      content: `[Context Summary — previous messages compressed]\n\n${summary}` },
        { role: "assistant", content: "Understood. I have the context summary and will continue from there." },
        ...tail,
    ]

    const before = estimateTotalTokens(messages)
    const after  = estimateTotalTokens(compressed)

    if (after >= before) return { status: "failed_inflated" }

    store.replaceAll(compressed)
    return { status: "compressed", tokensBefore: before, tokensAfter: after }
}

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

function findSplitPoint(messages: CoreMessage[]): number {
    // Use token estimates for consistent measurement with shouldCompress()
    const total = messages.reduce((s, m) => s + estimateTokens(m), 0)
    const target = total * (1 - PRESERVE_TAIL_RATIO)  // 70% of tokens
    let accumulated = 0
    let splitIdx = 0

    for (let i = 0; i < messages.length; i++) {
        accumulated += estimateTokens(messages[i])
        if (messages[i].role === "user" && accumulated >= target) {
            // Don't split if the previous message has unresolved tool calls
            const prev = messages[i - 1]
            if (prev && hasToolCalls(prev)) continue
            splitIdx = i
            break
        }
    }
    return splitIdx
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

import type { CoreMessage } from "ai"
import { Agent, type AgentConfig } from "../agent.js"
import { InMemoryStore } from "../store.js"
import type { SubagentConfig } from "./types.js"
import { forkChildToolRegistry } from "./forkTools.js"

function lastAssistantText(messages: CoreMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m.role !== "assistant") {
            continue
        }
        const c = m.content
        if (typeof c === "string") {
            return c
        }
    }
    return "(no assistant reply)"
}

/**
 * Run a one-shot child session: separate store, optional tool allowlist, no nested `agent` tool.
 */
export async function runChildAgent(
    parent: Agent,
    sub: SubagentConfig,
    taskPrompt: string,
    signal?: AbortSignal,
): Promise<string> {
    const store = new InMemoryStore()
    store.add({ role: "system", content: sub.systemPrompt } as CoreMessage)
    store.add({ role: "user", content: taskPrompt } as CoreMessage)

    const childTools = forkChildToolRegistry(parent.getToolsRegistry(), sub)
    const snap = parent.getConfigSnapshot()
    const childConfig: AgentConfig = {
        ...snap,
        store,
        tools: childTools,
        maxTurns: 5,
    }
    const child = new Agent(childConfig)

    for await (const _ of child.runSeeded(signal)) {
        /* events are intentionally discarded; parent UI shows parent stream only */
    }

    return lastAssistantText(store.getAll())
}

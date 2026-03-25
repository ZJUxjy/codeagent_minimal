import { describe, it, expect, vi, afterEach } from "vitest"
import type { CoreMessage } from "ai"
import { LLMClient } from "../../llm.js"
import { Agent } from "../agent.js"
import { runChildAgent } from "./runChildAgent.js"

describe("runChildAgent", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("passes system + user messages to the child LLM stream", async () => {
        const batches: CoreMessage[][] = []
        vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function (_messages: CoreMessage[]) {
            const msgs = _messages
            batches.push(msgs.map((m) => ({ ...m })))
            return (async function* () {
                yield { type: "done" as const, finishReason: "stop" }
            })()
        })

        const parent = new Agent({
            provider: "openai",
            model: "gpt-4o-mini",
            cwd: "/tmp",
        })
        const sub = {
            name: "t",
            description: "d",
            systemPrompt: "YOU ARE CHILD",
            level: "builtin" as const,
            isBuiltin: true,
        }
        await runChildAgent(parent, sub, "do the thing")

        expect(batches.length).toBeGreaterThan(0)
        const first = batches[0]
        expect(first[0]).toMatchObject({ role: "system", content: "YOU ARE CHILD" })
        expect(first[1]).toMatchObject({ role: "user", content: "do the thing" })
    })
})

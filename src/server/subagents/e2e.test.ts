import { describe, it, expect, vi, afterEach } from "vitest"
import type { CoreMessage } from "ai"
import { LLMClient } from "../../llm.js"
import { Agent } from "../agent.js"
import { evaluateToolPolicy } from "../security/policy.js"
import { listSubagents, loadSubagentByName } from "./manager.js"

describe("subagent e2e", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("agent tool is allowed by default security policy", () => {
        const decision = evaluateToolPolicy("agent", {})
        expect(decision).toBe("allow")
    })

    it("builtin subagents are discoverable", async () => {
        const agents = await listSubagents("/tmp")
        const names = agents.map(a => a.name)
        expect(names).toContain("explore")
        expect(names).toContain("general-purpose")
    })

    it("loadSubagentByName is case-insensitive", async () => {
        const upper = await loadSubagentByName("/tmp", "EXPLORE")
        const lower = await loadSubagentByName("/tmp", "explore")
        expect(upper).not.toBeNull()
        expect(upper!.name).toBe(lower!.name)
    })

    it("delegation tool round-trips through agent", async () => {
        // Mock LLM to simulate: parent calls agent tool → child runs → child replies
        let callCount = 0
        vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function (messages: CoreMessage[]) {
            callCount++
            if (callCount === 1) {
                // Parent LLM: emit a tool_call to the agent tool
                return (async function* () {
                    yield {
                        type: "tool_call" as const,
                        id: "tc_1",
                        name: "agent",
                        args: {
                            description: "test delegation",
                            prompt: "say hello",
                            subagent_type: "explore",
                        },
                    }
                    yield { type: "done" as const, finishReason: "tool_calls" }
                })()
            } else if (callCount === 2) {
                // Child LLM (subagent): reply with text
                return (async function* () {
                    yield { type: "content" as const, delta: "Hello from subagent!" }
                    yield { type: "done" as const, finishReason: "stop" }
                })()
            } else {
                // Parent LLM turn 2: summarize
                return (async function* () {
                    yield { type: "content" as const, delta: "Done." }
                    yield { type: "done" as const, finishReason: "stop" }
                })()
            }
        })

        const parent = new Agent({
            provider: "openai",
            model: "gpt-4o-mini",
            cwd: "/tmp",
        })

        const events: Array<{ type: string; [key: string]: unknown }> = []
        for await (const ev of parent.run("delegate something", undefined)) {
            events.push(ev)
        }

        // Should have: tool_call(agent) → tool_result → content("Done.") → done
        const toolCall = events.find(e => e.type === "tool_call" && e.name === "agent")
        expect(toolCall).toBeDefined()

        const toolResult = events.find(e => e.type === "tool_result")
        expect(toolResult).toBeDefined()
        expect(toolResult!.content).toContain("Hello from subagent!")

        expect(callCount).toBe(3) // parent turn 1, child, parent turn 2
    })

    it("child agent does not have access to agent tool (no recursion)", async () => {
        vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function () {
            return (async function* () {
                yield { type: "done" as const, finishReason: "stop" }
            })()
        })

        const parent = new Agent({
            provider: "openai",
            model: "gpt-4o-mini",
            cwd: "/tmp",
        })

        // Build child tools the same way runChildAgent does
        const { forkChildToolRegistry } = await import("./forkTools.js")
        const sub = await loadSubagentByName("/tmp", "general-purpose")
        const childTools = forkChildToolRegistry(parent.getToolsRegistry(), sub!)

        // Child should NOT have the agent tool
        expect(childTools.get("agent")).toBeUndefined()
    })
})

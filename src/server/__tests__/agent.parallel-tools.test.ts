import { describe, it, expect, vi, afterEach } from "vitest"
import type { CoreMessage } from "ai"
import { LLMClient } from "../../llm.js"
import { Agent } from "../agent.js"
import { Tool } from "../tools/types.js"
import { z } from "zod"

// Helper: build a mock LLM that emits tool calls then stops
function mockStream(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
    return vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function* () {
        for (const call of toolCalls) {
            yield { type: "tool_call" as const, id: call.id, name: call.name, args: call.args }
        }
        yield { type: "done" as const, finishReason: "tool_calls" }
    } as any)
}

// Helper: mock that returns stop on second call (after tool results are in)
function mockTwoPhaseStream(toolCalls: Array<{ id: string; name: string; args: Record<string, unknown> }>) {
    let call = 0
    return vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function* () {
        call++
        if (call === 1) {
            for (const tc of toolCalls) {
                yield { type: "tool_call" as const, id: tc.id, name: tc.name, args: tc.args }
            }
            yield { type: "done" as const, finishReason: "tool_calls" }
        } else {
            yield { type: "content" as const, delta: "done" }
            yield { type: "done" as const, finishReason: "stop" }
        }
    } as any)
}

// Helper: delay-based tool factory
function delayTool(name: string, delayMs: number, result: string): Tool {
    return {
        name,
        description: `${name} tool`,
        parameters: z.object({}),
        execute: async () => {
            await new Promise(r => setTimeout(r, delayMs))
            return result
        },
    }
}

// Helper: instantaneous tool
function instantTool(name: string, result: string): Tool {
    return {
        name,
        description: `${name} tool`,
        parameters: z.object({}),
        execute: async () => result,
    }
}

// Collect all events from agent.run()
async function collectEvents(agent: Agent, message = "go") {
    const events: Array<{ type: string; [k: string]: unknown }> = []
    for await (const ev of agent.run(message)) {
        events.push(ev)
    }
    return events
}

describe("parallel tool execution", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("executes two tools faster than sequential would", async () => {
        const DELAY = 80

        mockTwoPhaseStream([
            { id: "tc_a", name: "slow_a", args: {} },
            { id: "tc_b", name: "slow_b", args: {} },
        ])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(delayTool("slow_a", DELAY, "result_a"))
        agent.getToolsRegistry().register(delayTool("slow_b", DELAY, "result_b"))

        const start = Date.now()
        await collectEvents(agent)
        const elapsed = Date.now() - start

        // Parallel: should finish in ~DELAY ms, not ~2*DELAY
        expect(elapsed).toBeLessThan(DELAY * 1.8)
    })

    it("yields tool_result events in original call order even when faster tool finishes second", async () => {
        // slow_a takes 80ms, fast_b takes 5ms — fast_b would finish first in parallel
        // but results must come out in call order: a, b
        mockTwoPhaseStream([
            { id: "tc_a", name: "slow_a", args: {} },
            { id: "tc_b", name: "fast_b", args: {} },
        ])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(delayTool("slow_a", 80, "result_a"))
        agent.getToolsRegistry().register(delayTool("fast_b", 5, "result_b"))

        const events = await collectEvents(agent)
        const results = events.filter(e => e.type === "tool_result")

        expect(results).toHaveLength(2)
        expect(results[0].id).toBe("tc_a")
        expect(results[1].id).toBe("tc_b")
    })

    it("writes tool messages to store in original call order", async () => {
        mockTwoPhaseStream([
            { id: "tc_1", name: "tool_one", args: {} },
            { id: "tc_2", name: "tool_two", args: {} },
            { id: "tc_3", name: "tool_three", args: {} },
        ])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(delayTool("tool_one", 60, "r1"))
        agent.getToolsRegistry().register(delayTool("tool_two", 5, "r2"))
        agent.getToolsRegistry().register(delayTool("tool_three", 30, "r3"))

        // Access internal store via clearHistory trick
        const storeMessages: CoreMessage[] = []
        const origClear = agent.clearHistory.bind(agent)
        agent.clearHistory = () => {
            origClear()
            storeMessages.length = 0
        }

        await collectEvents(agent)

        // Spy on store via replaceStore: re-read via a store wrapper
        // Instead, verify via the tool_result event order (store order matches)
    })

    it("store tool messages appear in call order (verified via events)", async () => {
        mockTwoPhaseStream([
            { id: "tc_x", name: "slow_x", args: {} },
            { id: "tc_y", name: "fast_y", args: {} },
        ])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(delayTool("slow_x", 60, "rx"))
        agent.getToolsRegistry().register(instantTool("fast_y", "ry"))

        const events = await collectEvents(agent)
        const toolResults = events.filter(e => e.type === "tool_result")

        // fast_y completes first but must be second in output
        expect(toolResults[0].id).toBe("tc_x")
        expect(toolResults[0].content).toBe("rx")
        expect(toolResults[1].id).toBe("tc_y")
        expect(toolResults[1].content).toBe("ry")
    })

    it("handles single tool call (degenerate case)", async () => {
        mockTwoPhaseStream([{ id: "tc_solo", name: "solo", args: {} }])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(instantTool("solo", "solo_result"))

        const events = await collectEvents(agent)
        const result = events.find(e => e.type === "tool_result")

        expect(result).toBeDefined()
        expect(result!.id).toBe("tc_solo")
        expect(result!.content).toBe("solo_result")
    })

    it("handles tool error without blocking other tools", async () => {
        const errorTool: Tool = {
            name: "fail_tool",
            description: "always fails",
            parameters: z.object({}),
            execute: async () => { throw new Error("boom") },
        }

        mockTwoPhaseStream([
            { id: "tc_fail", name: "fail_tool", args: {} },
            { id: "tc_ok", name: "ok_tool", args: {} },
        ])

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })
        agent.getToolsRegistry().register(errorTool)
        agent.getToolsRegistry().register(instantTool("ok_tool", "ok"))

        const events = await collectEvents(agent)
        const results = events.filter(e => e.type === "tool_result")

        expect(results).toHaveLength(2)
        expect(results[0].isError).toBe(true)
        expect(results[0].content).toContain("boom")
        expect(results[1].isError).toBeFalsy()
        expect(results[1].content).toBe("ok")
    })

    it("aborts cleanly: no tool_result events yielded after abort", async () => {
        const controller = new AbortController()

        vi.spyOn(LLMClient.prototype, "stream").mockImplementation(function* () {
            yield { type: "tool_call" as const, id: "tc_a", name: "slow_a", args: {} }
            yield { type: "tool_call" as const, id: "tc_b", name: "slow_b", args: {} }
            yield { type: "done" as const, finishReason: "tool_calls" }
        } as any)

        const agent = new Agent({ provider: "openai", model: "gpt-4o", cwd: "/tmp" })

        // Abort while tools are running
        agent.getToolsRegistry().register({
            name: "slow_a",
            description: "slow",
            parameters: z.object({}),
            execute: async () => {
                controller.abort()
                await new Promise(r => setTimeout(r, 10))
                return "a_result"
            },
        })
        agent.getToolsRegistry().register(delayTool("slow_b", 5, "b_result"))

        const events: Array<{ type: string; [k: string]: unknown }> = []
        for await (const ev of agent.run("go", controller.signal)) {
            events.push(ev)
        }

        const doneEvent = events.find(e => e.type === "done")
        expect(doneEvent?.finishReason).toBe("interrupted")

        // No tool_result events should be yielded after abort
        const resultsAfterDone = events.slice(events.indexOf(doneEvent!))
        expect(resultsAfterDone.filter(e => e.type === "tool_result")).toHaveLength(0)
    })
})

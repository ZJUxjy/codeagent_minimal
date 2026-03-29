import type { AgentHooks } from "../hooks/types.js"
import type { QuestionBridge } from "../questionBridge.js"
import { PermissionEngine } from "./permissionEngine.js"

/** Build a one-line human-readable description of a tool call for the prompt. */
function summarizeToolCall(name: string, args: Record<string, unknown>): string {
    if (name === "bash") {
        const cmd = String(args.command ?? "").trim()
        // Truncate long commands
        return `bash: ${cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd}`
    }
    if (name === "write" || name === "edit") {
        return `${name}: ${String(args.file_path ?? "")}`
    }
    return name
}

/**
 * Create a `beforeToolExecute` hook that gates tool calls through the
 * PermissionEngine and, when the result is "ask", suspends the agent loop
 * and prompts the user via the TUI.
 */
export function createPermissionHook(
    engine: PermissionEngine,
    bridge: QuestionBridge,
): NonNullable<AgentHooks["beforeToolExecute"]> {
    return async (call, _tool) => {
        const level = engine.check(call.name, call.args)

        if (level === "allow") return "allow"
        if (level === "deny")  return "deny"

        // "ask" — suspend agent and prompt the user
        const summary = summarizeToolCall(call.name, call.args)
        const outcome = await bridge.askPermission(call.name, summary)

        if (outcome === "always") {
            engine.addSessionAllowRule(call.name)
        }

        return outcome === "deny" ? "deny" : "allow"
    }
}

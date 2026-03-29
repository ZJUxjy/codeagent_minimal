import type { AgentHooks } from "../hooks/types.js"
import type { QuestionBridge } from "../questionBridge.js"
import { PermissionEngine } from "./permissionEngine.js"
import { truncate } from "../../utils/truncate.js"

function summarizeToolCall(name: string, args: Record<string, unknown>): string {
    if (name === "bash") {
        const cmd = String(args.command ?? "").trim()
        return `bash: ${truncate(cmd, 80, "…")}`
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

        const summary = summarizeToolCall(call.name, call.args)
        const outcome = await bridge.askPermission(call.name, summary)

        if (outcome === "always") {
            engine.addSessionAllowRule(call.name)
        }

        return outcome === "deny" ? "deny" : "allow"
    }
}

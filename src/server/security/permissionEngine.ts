import { evaluateToolPolicy, type PermissionLevel } from "./policy.js"

export type ApprovalMode = "default" | "cautious" | "auto"

interface SessionRule {
  toolName: string
  /** Exact command/path for scoped "always allow" (e.g. "npm test") */
  specifier?: string
}

interface RuleSet {
  allow: SessionRule[]
  deny: SessionRule[]
}

/**
 * Central permission evaluation engine.
 *
 * Priority (highest first):
 *   1. Session deny rules
 *   2. Session allow rules (with optional specifier matching)
 *   3. Approval mode override (auto / cautious)
 *   4. Built-in policy heuristics (evaluateToolPolicy)
 */
export class PermissionEngine {
  private sessionRules: RuleSet = { allow: [], deny: [] }

  constructor(
    private approvalMode: ApprovalMode = "default",
    private cwd: string = process.cwd(),
  ) {}

  check(toolName: string, args: Record<string, unknown>): PermissionLevel {
    if (this.matchesRule(this.sessionRules.deny, toolName, args))  return "deny"
    if (this.matchesRule(this.sessionRules.allow, toolName, args)) return "allow"

    if (this.approvalMode === "auto")     return "allow"
    if (this.approvalMode === "cautious") return this.cautiousDefault(toolName)

    return evaluateToolPolicy(toolName, args, this.cwd)
  }

  /** Add a session-scoped allow rule (survives for current session only). */
  addSessionAllowRule(toolName: string, specifier?: string): void {
    const exists = this.sessionRules.allow.some(
      r => r.toolName === toolName && r.specifier === specifier
    )
    if (!exists) {
      this.sessionRules.allow.push({ toolName, specifier })
    }
  }

  setApprovalMode(mode: ApprovalMode): void {
    this.approvalMode = mode
  }

  getApprovalMode(): ApprovalMode {
    return this.approvalMode
  }

  private cautiousDefault(toolName: string): PermissionLevel {
    const mutatingTools = new Set(["bash", "write", "edit"])
    return mutatingTools.has(toolName) ? "ask" : "allow"
  }

  private matchesRule(rules: SessionRule[], toolName: string, args: Record<string, unknown>): boolean {
    return rules.some(r => {
      if (r.toolName !== toolName) return false
      if (!r.specifier) return true // no specifier = match any usage of this tool
      return specifierFromCall(toolName, args) === r.specifier
    })
  }
}

/** Extract a specifier from a tool call for scoped "always allow" rules. */
export function specifierFromCall(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "bash") return String(args.command ?? "")
  if (toolName === "write" || toolName === "edit") return String(args.file_path ?? "")
  return toolName
}

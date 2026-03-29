import { evaluateToolPolicy, type PermissionLevel } from "./policy.js"

export type ApprovalMode = "default" | "cautious" | "yolo"

interface SessionRule {
  toolName: string
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
 *   2. Session allow rules
 *   3. Approval mode override (yolo / cautious)
 *   4. Built-in policy heuristics (evaluateToolPolicy)
 */
export class PermissionEngine {
  private sessionRules: RuleSet = { allow: [], deny: [] }

  constructor(
    private approvalMode: ApprovalMode = "default",
    private cwd: string = process.cwd(),
  ) {}

  check(toolName: string, args: Record<string, unknown>): PermissionLevel {
    if (this.matchesRule(this.sessionRules.deny, toolName))  return "deny"
    if (this.matchesRule(this.sessionRules.allow, toolName)) return "allow"

    if (this.approvalMode === "yolo")     return "allow"
    if (this.approvalMode === "cautious") return this.cautiousDefault(toolName)

    return evaluateToolPolicy(toolName, args, this.cwd)
  }

  /** Add a session-scoped allow rule (survives for current session only). */
  addSessionAllowRule(toolName: string): void {
    if (!this.matchesRule(this.sessionRules.allow, toolName)) {
      this.sessionRules.allow.push({ toolName })
    }
  }

  private cautiousDefault(toolName: string): PermissionLevel {
    const mutatingTools = new Set(["bash", "write", "edit"])
    return mutatingTools.has(toolName) ? "ask" : "allow"
  }

  private matchesRule(rules: SessionRule[], toolName: string): boolean {
    return rules.some(r => r.toolName === toolName)
  }
}

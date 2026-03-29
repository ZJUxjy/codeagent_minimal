# Permission & Security System — Development Plan

**Date:** 2026-03-29
**Reviewed by:** Claude Opus 4.6
**Scope:** Wire up and extend the existing permission scaffolding into a production-ready, user-facing permission system.

---

## Current State

| File | Status | Gap |
|---|---|---|
| `src/server/security/policy.ts` | ✅ Exists | Pattern matching works; but `"ask"` is treated as `"deny"` (no prompt) |
| `src/server/hooks/types.ts` | ✅ `beforeToolExecute` defined | Returns `PolicyDecision`, no prompt mechanism |
| `src/server/agent.ts` | ⚠️ Has two policy checks | Lines 285-291: inline `evaluateToolPolicy` (treats "ask" as deny); lines 293-298: hook check (ignores "ask"). Both must be **replaced** by a single unified path |
| `src/server/tools/bash.ts` | ✅ Executes commands | No policy check at call site (correctly delegated to agent.ts) |
| TUI | — | No confirmation prompt component exists |

The core problem: `"ask"` decisions have no user-facing prompt — they silently become denials. The goal is to replace silent denial with an actual interactive choice, and unify the two redundant policy checks in `agent.ts` into a single hook-based path.

> **⚠️ Double-evaluation risk:** `agent.ts` currently calls `evaluateToolPolicy` inline (lines 285-291) AND calls `hooks.beforeToolExecute` (lines 293-298). Phase 1 must **remove** the inline call, not add yet another check alongside it.

---

## Design Goals

1. **Minimal friction for safe operations** — read-only and common tools never interrupt
2. **Confirm before dangerous operations** — interactive prompt with Allow / Always Allow / Deny
3. **Persistent "always allow" rules** — decisions survive session restarts
4. **Approval modes** — power users can set `yolo` (never ask) or `cautious` (ask for all writes)
5. **No AST dependency in v1** — pattern/regex matching is sufficient; tree-sitter can come later
6. **Config-file rules** — allow/deny lists in `.lop/config.json` for CI/automated use
7. **Non-interactive fallback** — when no TUI is connected (Client API), "ask" degrades to "deny" with a clear error

---

## Architecture Overview

```
Tool call arrives
      │
      ▼
[PermissionEngine.check(toolName, args, cwd)]   ← all policy logic lives here
      │
   ┌──┴──────────────────────┐
   │  1. Explicit deny rule?  │──► DENY (abort tool, return error to model)
   │  2. Explicit allow rule? │──► ALLOW (execute immediately)
   │  3. Built-in policy?     │──► "allow" / "ask" / "deny"
   │     • approval mode      │
   └──────────────────────────┘
      │ "ask"
      ▼
[QuestionBridge.askPermission()]   ← TUI suspends agent loop, user responds
      │
      ├─ Allow Once   ──► execute, rule saved to sessionRules only
      ├─ Always Allow ──► execute, rule saved to disk (Phase 4)
      └─ Deny         ──► abort, return refusal to model

      │ no TUI connected (non-interactive)
      ▼
"ask" → "deny" with error: "Configure allow rules or use --approval-mode yolo"
```

---

## Phase 1+2: Policy Unification + TUI Prompt (single PR)

**Goal:** Replace the two redundant policy checks with a single `PermissionEngine` path, wire up the TUI confirmation prompt, and ensure rejected tools return error results to the LLM (not silently dropped).

> **Phase 1 and 2 are merged into a single PR** because the hook depends on `askPermission()` and the prompt depends on the hook. Developing them separately would require stubs or broken intermediate states.

### 1.1 Path traversal fix

Fix `policy.ts` **first** — before wiring prompts, because converting "ask"-as-deny to "ask"-as-prompt weakens the current path traversal protection.

```typescript
// BEFORE (bypassable with ./foo/../../etc/passwd):
if (filePath.startsWith("..") || filePath.startsWith("/")) return "ask"

// AFTER:
const resolved = path.resolve(cwd, filePath)
if (!resolved.startsWith(path.resolve(cwd) + path.sep)) return "ask"
```

Also add hard `"deny"` for sensitive system paths: `~/.ssh/`, `/etc/`, `.git/config`.

### 1.2 Permission Engine (`src/server/security/permissionEngine.ts`)

Wraps `evaluateToolPolicy` with session-rule awareness (disk persistence added in Phase 4):

```typescript
export class PermissionEngine {
  private sessionRules: RuleSet = { allow: [], deny: [] }

  constructor(private approvalMode: ApprovalMode, private interactive: boolean) {}

  check(toolName: string, args: Record<string, unknown>, cwd: string): PolicyDecision {
    if (this.matchesRule(this.sessionRules.deny, toolName, args))  return "deny"
    if (this.matchesRule(this.sessionRules.allow, toolName, args)) return "allow"

    if (this.approvalMode === "yolo")     return "allow"
    if (this.approvalMode === "cautious") return this.cautiousDefault(toolName)

    return evaluateToolPolicy(toolName, args, cwd)
  }

  addSessionAllowRule(rule: Rule): void {
    this.sessionRules.allow.push(rule)
  }
}
```

- Uses existing `PolicyDecision` type (`"allow" | "deny" | "ask"`) — no new type alias needed.
- `interactive: boolean` — when `false`, "ask" results are never returned; the hook converts them to "deny" immediately.

### 1.3 Hook implementation (`src/server/security/permissionHook.ts`)

```typescript
export function createPermissionHook(
  engine: PermissionEngine,
  bridge: QuestionBridge | undefined,  // undefined in non-interactive mode
  cwd: string,
): AgentHooks["beforeToolExecute"] {
  return async (call, _tool) => {
    const level = engine.check(call.name, call.args, cwd)
    if (level === "allow") return "allow"
    if (level === "deny")  return "deny"

    // "ask" — but no TUI available
    if (!bridge) return "deny"

    const decision = await bridge.askPermission({
      toolName: call.name,
      args: call.args,
      summary: summarizeToolCall(call),
    })
    if (decision === "always") {
      engine.addSessionAllowRule({ tool: call.name, specifier: specifierFromCall(call) })
    }
    return decision === "deny" ? "deny" : "allow"
  }
}
```

- `cwd` is passed into the factory (not read from closure) since the hook only receives `(call, tool)`.
- `bridge` is optional — when `undefined` (Client API / non-interactive), "ask" → "deny".
- `summarizeToolCall(call)` returns a human-readable summary for the prompt:
  - `bash` → full command string
  - `write`/`edit` → file path
  - MCP tools → tool name + key args (first string arg)
- `specifierFromCall(call)` generates an exact-match specifier for "Always allow" rules in v1:
  - `bash` → the exact command string
  - `write`/`edit` → the exact file path
  - Other tools → exact tool name

Timeout: if `bridge.askPermission` does not resolve within 60 seconds (e.g. user walks away), default to `"deny"`. Reuse existing abort signal pattern.

### 1.4 Update `agent.ts` `executeTool`

**Remove** the inline policy block (lines 285-291). All policy logic moves into the hook:

```typescript
// DELETE these lines:
// const policyDecision = evaluateToolPolicy(call.name, call.args)
// if (policyDecision === "deny") { ... }
// if (policyDecision === "ask") { ... }

// Keep and harden the hook check — treat anything not explicitly "allow" as deny:
if (this.hooks.beforeToolExecute) {
  const decision = await this.hooks.beforeToolExecute(call, tool)
  if (decision !== "allow") {  // defensive: unknown values deny
    return { content: "Permission denied.", isError: true }
  }
}
```

### 1.5 Serialize permission checks, preserve store consistency

Tools run via `Promise.all` in `runLoop`. Two simultaneous "ask" prompts create a confusing UX. Pre-check permissions sequentially, then execute approved tools — but **rejected tools must still produce tool_result entries** so the LLM and store remain consistent:

```typescript
// Pre-check all tool calls sequentially
const decisions = new Map<string, PolicyDecision>()
for (const call of pendingToolEvents) {
  const decision = this.hooks.beforeToolExecute
    ? await this.hooks.beforeToolExecute(call, tool)
    : "allow"
  decisions.set(call.id, decision)
}

// Execute all tools — approved ones run normally, denied ones return error results
const results = await Promise.all(
  pendingToolEvents.map(call => {
    if (decisions.get(call.id) !== "allow") {
      return { content: `Permission denied for '${call.name}'.`, isError: true }
    }
    return this.executeTool(call)
  })
)
```

This ensures every `tool_call` has a matching `tool_result` in the store, so the LLM can adapt when its action is denied.

Log every decision at debug level: `[permission] bash(rm -rf ./dist) → ask → denied by user`

### 2.1 Extend QuestionBridge

```typescript
export interface PermissionRequest {
  toolName: string
  args: Record<string, unknown>
  summary: string      // e.g. "bash: rm -rf ./dist"
}

export type PermissionOutcome = "allow" | "always" | "deny"

// Add to QuestionBridge:
askPermission(req: PermissionRequest, signal?: AbortSignal): Promise<PermissionOutcome>
```

### 2.2 TUI PermissionPrompt component

Inline in the message stream (reuses the existing question bridge pause pattern):

```
┌─ Permission Required ─────────────────────────┐
│  bash: rm -rf ./dist                           │
│                                                │
│  [A] Allow once   [W] Always allow   [D] Deny  │
└────────────────────────────────────────────────┘
```

Keyboard: `a` / `w` / `d`. Falls back to auto-deny after 60s timeout.

Add `permissionRequest` as a new pending state variant in `sessionReducer`.

**Files changed (Phase 1+2):** `agent.ts`, `policy.ts`, `questionBridge.ts`, `sessionReducer.ts`, `types.ts`, new `permissionEngine.ts`, new `permissionHook.ts`, new `PermissionPrompt.tsx`

---

## Phase 3: Approval Modes

**Goal:** Global setting controlling default behavior (now testable since prompt exists).

```typescript
export type ApprovalMode =
  | "default"   // ask for dangerous ops (policy.ts behavior)
  | "cautious"  // ask for all writes/edits/bash
  | "yolo"      // allow everything — power users, CI
  // NOTE: "plan" mode (read-only agent) is a separate feature, not a permission mode
```

Config in `.lop/config.json`:

```json
{
  "approvalMode": "default",
  "permissions": {
    "allow": ["bash(git *)", "bash(npm run *)"],
    "deny":  ["bash(rm -rf *)"]
  }
}
```

CLI flag: `--approval-mode yolo`.

TUI command: `/approval-mode [default|cautious|yolo]` — switches mode mid-session. Zero cost since `PermissionEngine` already holds the mode.

**Files changed:** `src/protocol/types.ts`, `src/server/index.ts`, `permissionEngine.ts`, new `approvalModeCommand.ts`

---

## Phase 4: Rule Store & Persistence

**Goal:** "Always allow" choices survive session restart. Session rules from Phase 1 are promoted to disk.

### 4.1 Rule store (`src/server/security/ruleStore.ts`)

```typescript
export interface Rule {
  tool: string          // e.g. "bash"
  specifier?: string    // e.g. "git *"  (glob)
  createdAt: string
}

export interface RuleSet { allow: Rule[]; deny: Rule[] }
```

Storage locations and trust hierarchy:
- `~/.lop/permissions.json` — **user-level**: can add allow rules, set any approval mode
- `.lop/permissions.json` — **project-level**: can only **restrict** (deny rules only); cannot add allow rules or override to `yolo`

> **Trust boundary:** A malicious cloned repo could ship `.lop/permissions.json` with permissive allow rules. Project-level files are therefore restricted to deny-only to prevent this attack vector.

### 4.2 Rule matching

- **bash**: glob match on command string — `bash(git *)` matches `git clone`, `git pull`. Match against the full command string after the base command.
- **write / edit**: picomatch path pattern — `write(./src/**)`
- **read**: path pattern
- **mcp tools**: exact tool name match

Use `picomatch` (already a transitive dep via `fast-glob`).

### 4.3 `/permissions` command (view-only for v1)

Expose rules without requiring manual rule editing (the TUI prompt is the primary creation path):

```
/permissions list     — show current session + persistent rules
```

Full add/remove commands deferred until clear user demand.

**Files changed:** new `ruleStore.ts`, update `permissionEngine.ts` to load rules, new `permissionsCommand.ts`

---

## Phase 5: Built-in Policy Improvements

**Goal:** Reduce false positives that cause unnecessary friction.

### Problems with current `DANGEROUS_BASH_COMMANDS` flat list

- `curl` triggers "ask" for `curl https://api.github.com` — benign read
- `npm` triggers "ask" for `npm run test` — benign
- `chmod` triggers for `chmod +x ./build.sh` — low risk

### Better heuristics

```
Pattern                              → Permission   Reason
────────────────────────────────────────────────────────────
rm -rf / or rm -rf ~                 → deny         Catastrophic
rm -rf <any arg>                     → ask          Irreversible
sudo <anything>                      → ask          Privilege escalation
curl/wget <url> | bash               → deny         Pipe-to-shell
eval "..."                           → deny         Arbitrary execution
env / printenv                        → ask          Secrets exfiltration (cautious only)
echo $VAR with secret patterns       → ask          Secrets exfiltration (cautious only)
cat ~/.ssh/* / cat .env              → ask          Secrets exfiltration
git push --force (main|master)       → ask          Destructive git op
chmod 777 ...                        → ask          Overly permissive
npm install / pip install            → ask          Package install
npm run / pip exec                   → allow        Script execution (safe)
```

Note: `env`, `printenv`, and `echo $VAR` are "ask" only in `cautious` mode — in `default` mode they are `allow` since they are common debugging operations.

Replace the flat list with a structured `BuiltinRule[]` with `pattern: RegExp`, `level`, `reason` fields, and an optional `mode` field (when `"cautious"`, the rule only applies in cautious mode).

**Files changed:** `src/server/security/policy.ts`

---

## Revised Implementation Order

| Phase | Content | Effort | Priority |
|---|---|---|---|
| 1+2 | Policy unification + TUI prompt (single PR) | L (6–8h) | **P0** |
| 3 | Approval modes + `/approval-mode` command | S (1–2h) | **P0** |
| 4 | Rule persistence | M (3–4h) | **P1** |
| 5 | Policy heuristic improvements | S (2h) | **P1** |

Phases 1–3 are the MVP. Dangerous operations will prompt the user instead of silently failing.

---

## What We Intentionally Skip

| Feature | Reason |
|---|---|
| AST-based shell parsing (tree-sitter) | Heavy dep; regex covers 95% of real cases |
| Virtual operation extraction (shell→read/write mapping) | Too complex; v2 candidate |
| Minimum-scope rule auto-generation | UX complexity; manual prompt is sufficient |
| `"plan"` approval mode | Different feature (read-only agent), not a permission mode — design separately |
| `/permissions allow` CLI command | TUI "Always allow" button is the natural creation path; manual add deferred |

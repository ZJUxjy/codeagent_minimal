# New Tools Implementation Plan: webfetch · todowrite · memory · batch · plan_mode

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new tools/features to lop_minimal, informed by opencode and qwen-code implementations. Each tool follows the existing `Tool` interface pattern in `src/server/tools/`.

**Reference codebases:**
- opencode: `/home/xjingyao/code/agent/opencode/packages/opencode/src/tool/`
- qwen-code: `/home/xjingyao/code/agent/qwen-code/packages/core/src/tools/`

**Tech Stack:** TypeScript, Zod, existing ToolRegistry + PermissionEngine

---

## Design Decisions (pre-settled)

### 1. webfetch
- **Name:** `webfetch` (matches opencode; more descriptive than qwen's `web_fetch`)
- **Parameters:** `url: string`, `format: "text" | "markdown" | "html"` (default markdown), optional `timeout: number`
- **Implementation:** Native `fetch()` + lightweight HTML cleanup helpers. No LLM-in-the-loop. Cap response at 2MB.
- **Security baseline:** Must reject localhost / loopback / private IP / link-local / IPv6 local ranges, and re-check every redirect target before following. Note: this is a best-effort regex check (same approach as opencode/qwen-code). It does not defend against DNS rebinding, IPv6-mapped IPv4, or hex-encoded IPs. The real security boundary is the absence of internal credentials — not URL filtering.
- **Permission model:** Do **not** add a `permission` field to the tool. Instead route `webfetch` through `src/server/security/policy.ts` so the existing PermissionEngine can return `ask`.
- **Why not qwen's approach:** qwen passes fetched content through Gemini again — adds cost and latency. opencode's plain conversion is simpler and composable.

### 2. todowrite
- **Name:** `todowrite` (matches opencode)
- **Parameters:** `todos: Array<{ id: string, content: string, status: "pending"|"in_progress"|"completed", priority?: "high"|"medium"|"low" }>`
- **Storage (v1):** JSON file at `.lop/todos.json` under the current workspace root (`ctx.cwd`). No per-session file and no TUI sync in v1. **Known limitation:** per-workspace, last-writer-wins — multiple concurrent sessions sharing the same workspace will overwrite each other's todos. Both opencode and qwen-code use per-session storage (SQLite key / `<sessionId>.json`), but lop_minimal's `ToolContext` does not carry a `sessionId` yet. Session isolation is deferred to v2.
- **Design:** Full replace on each call (opencode approach) — simpler than diff-based. Enforce max 1 `in_progress` at a time.
- **User visibility:** In v1, todo state is visible through normal tool output only. Session-scoped persistence and dedicated TUI rendering are deferred to a later feature.

### 3. memory
- **Name:** `save_memory`
- **Parameters:** `fact: string`, `scope: "global" | "project"` (default: project)
- **Storage:** Appends to `MEMORY.md` in project root (scope=project) or `~/.lop/MEMORY.md` (scope=global) under a `## Memories` section.
- **Why Markdown file:** qwen-code approach — simple, human-readable, survives tool restarts, users can edit directly. opencode relies on DB which adds infrastructure.
- **Auto-injection:** At session start, read `MEMORY.md` and inject into the runtime system prompt. v1 does not attempt to hot-refresh the injected memory after `save_memory` is called; the new memory is guaranteed to appear on the next session start.

### 4. batch
- **Name:** `batch`
- **Parameters:** `tool_calls: Array<{ tool: string, parameters: Record<string, unknown> }>`
- **Cap:** 10 tool calls max (vs opencode's 25 — more conservative for our use case).
- **Execution:** `Promise.all()` for true parallelism.
- **Restriction:** v1 is limited to an explicit read-only allowlist such as `read`, `glob`, `grep`, `listDirectory`. Cannot batch `batch` itself, mutating tools, or MCP tools.
- **Why explicit tool vs scheduler strategy:** opencode has a dedicated `batch` tool which is more transparent to the model. qwen-code's scheduler-level approach is implicit. Explicit is better.

### 5. plan_mode
- **Shape:** `ApprovalMode.PLAN` state + `/plan` slash command. No dedicated `exit_plan_mode` tool in v1.
- **Design:** Add `"plan"` to `ApprovalMode` type. In plan mode, `write` and `edit` return `"deny"`. For `bash`, delegate to `evaluateToolPolicy()` so catastrophic commands are still denied but read-only commands like `ls`, `git log`, `git diff` are allowed. All other tools return `"allow"`. This matches qwen-code's approach (AST-based read-only detection) but uses lop_minimal's existing `BASH_RULES` instead of tree-sitter.
- **Entry/exit:** `/plan` enters plan mode. Users leave plan mode with the existing `/approval-mode default` command.
- **Why not an exit tool:** The current tool contract only returns a string and `ToolContext` does not expose a mode-switch API. A slash-command-only approach fits the current architecture with much less blast radius.

---

## File Structure

| File | Action | Notes |
|------|--------|-------|
| `src/server/tools/webfetch.ts` | **Create** | webfetch tool |
| `src/server/tools/todowrite.ts` | **Create** | todowrite tool |
| `src/server/tools/memory.ts` | **Create** | save_memory tool |
| `src/server/tools/batch.ts` | **Create** | batch tool |
| `src/server/tools/index.ts` | **Modify** | register all 5 new tools |
| `src/server/security/policy.ts` | **Modify** | add webfetch policy + URL-sensitive handling |
| `src/server/security/permissionEngine.ts` | **Modify** | add "plan" to ApprovalMode, deny mutating tools in plan mode |
| `src/protocol/types.ts` | **Modify** | add "plan" to approvalMode union |
| `src/client/index.ts` | **Modify** | update setApprovalMode type |
| `src/index.ts` | **Modify** | add "plan" to CLI --approval-mode parsing |
| `src/server/index.ts` | **Modify** | add "plan" to set_approval_mode handler |
| `src/commands/builtin/approvalModeCommand.ts` | **Modify** | add "plan" to VALID_MODES, update help text |
| `src/commands/builtin/planCommand.ts` | **Create** | /plan slash command to enter plan mode |
| `src/commands/builtin/index.ts` | **Modify** | export + register planCommand |

---

## Task 1: webfetch tool

**Files:** Create `src/server/tools/webfetch.ts`; modify `src/server/security/policy.ts`

- [ ] **Step 1: Create the tool**

```typescript
// src/server/tools/webfetch.ts
import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const MAX_BYTES = 2 * 1024 * 1024 // 2MB

export const webfetchTool: Tool = {
    name: "webfetch",
    description: `Fetch content from a URL and return it as text, markdown, or raw HTML.
- Requires network access — use only for public URLs
- Response capped at 2MB
- For local files, use the read tool instead`,
    parameters: z.object({
        url: z.string().describe("The URL to fetch (must start with http:// or https://)"),
        format: z.enum(["markdown", "text", "html"]).default("markdown")
            .describe("Return format. markdown strips tags and formats links. text is plain. html is raw."),
        timeout: z.number().optional().describe("Timeout in seconds (max 30, default 10)"),
    }),
    async execute({ url, format, timeout }: { url: string; format: string; timeout?: number }, ctx: ToolContext) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return "Error: URL must start with http:// or https://"
        }

        const timeoutMs = Math.min((timeout ?? 10), 30) * 1000
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
            const res = await fetch(url, {
                signal: controller.signal,
                headers: { "User-Agent": "lop-minimal/1.0" },
            })

            if (!res.ok) {
                return `Error: HTTP ${res.status} ${res.statusText}`
            }

            // Check size via Content-Length before reading body
            const contentLength = Number(res.headers.get("content-length") ?? 0)
            if (contentLength > MAX_BYTES) {
                return `Error: response too large (${contentLength} bytes, max 2MB)`
            }

            const rawText = await res.text()
            if (Buffer.byteLength(rawText) > MAX_BYTES) {
                return `Error: response body too large (max 2MB)`
            }

            if (format === "html") return rawText
            if (format === "text") return htmlToText(rawText)
            return htmlToMarkdown(rawText)
        } finally {
            clearTimeout(timer)
        }
    },
}

/** Strip HTML tags and collapse whitespace */
function htmlToText(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

/** Minimal HTML→Markdown: headers, links, code, paragraphs */
function htmlToMarkdown(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) =>
            "\n" + "#".repeat(Number(level)) + " " + stripTags(text) + "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) =>
            `[${stripTags(text)}](${href})`)
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => "`" + code + "`")
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => "\n```\n" + stripTags(code) + "\n```\n")
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => "- " + stripTags(text) + "\n")
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => "\n" + stripTags(text) + "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, "").trim()
}
```

- [ ] **Step 2: Register in ToolRegistry**

In `src/server/tools/index.ts`, add:
```typescript
import { webfetchTool } from "./webfetch.js"
// ...in constructor:
this.register(webfetchTool)
```

- [ ] **Step 3: Add security policy coverage**

In `src/server/security/policy.ts`, add a `webfetch` branch that returns `ask` by default and keeps URL-sensitive policy in one place. The tool implementation itself must still perform SSRF validation and redirect re-checks; policy is not a substitute for input validation.

- [ ] **Step 4: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 5: Commit**

```bash
git add src/server/tools/webfetch.ts src/server/tools/index.ts src/server/security/policy.ts
git commit -m "feat: add webfetch tool"
```

---

## Task 2: todowrite tool

**Files:** Create `src/server/tools/todowrite.ts`

- [ ] **Step 1: Create the tool**

```typescript
// src/server/tools/todowrite.ts
import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import * as path from "path"
import * as os from "os"
import type { Tool, ToolContext } from "./types.js"

const TodoItem = z.object({
    id: z.string().describe("Unique identifier for the todo item"),
    content: z.string().min(1).describe("Brief description of the task"),
    status: z.enum(["pending", "in_progress", "completed"]).describe("Current status"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level"),
})

export const todowriteTool: Tool = {
    name: "todowrite",
    description: `Manage a structured todo list for tracking tasks in the current session.
- Use for tasks with 3 or more distinct steps
- Keep at most one item in_progress at a time
- Update in real-time as work progresses — do not batch updates
- The list persists for the session and is shown to the user`,
    parameters: z.object({
        todos: z.array(TodoItem).describe("The complete updated todo list (full replace)"),
    }),

    async execute({ todos }: { todos: z.infer<typeof TodoItem>[] }, ctx: ToolContext) {
        // Validate: at most one in_progress
        const inProgress = todos.filter(t => t.status === "in_progress")
        if (inProgress.length > 1) {
            return { content: "Error: at most one todo item can be in_progress at a time" }
        }

        // Validate: unique IDs
        const ids = todos.map(t => t.id)
        if (new Set(ids).size !== ids.length) {
            return { content: "Error: todo item IDs must be unique" }
        }

        // Persist to .lop/todos.json under current workspace
        const todoDir = path.join(ctx.cwd, ".lop")
        if (!existsSync(todoDir)) {
            await mkdir(todoDir, { recursive: true })
        }
        const todoFile = path.join(todoDir, "todos.json")
        await writeFile(todoFile, JSON.stringify(todos, null, 2), "utf-8")

        const pending = todos.filter(t => t.status === "pending").length
        const done = todos.filter(t => t.status === "completed").length
        const summary = todos.length === 0
            ? "Todo list cleared."
            : `Todo list updated: ${todos.length} items (${pending} pending, ${done} completed)`

        return summary + "\n\n" + JSON.stringify(todos, null, 2)
    },
}
```

- [ ] **Step 2: Register in ToolRegistry**

In `src/server/tools/index.ts`, add:
```typescript
import { todowriteTool } from "./todowrite.js"
// ...in constructor:
this.register(todowriteTool)
```

- [ ] **Step 3: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 4: Commit**

```bash
git add src/server/tools/todowrite.ts src/server/tools/index.ts
git commit -m "feat: add todowrite tool"
```

---

## Task 3: save_memory tool

**Files:** Create `src/server/tools/memory.ts`; modify `src/server/agent.ts`

- [ ] **Step 1: Create the tool**

```typescript
// src/server/tools/memory.ts
import { z } from "zod"
import { readFile, writeFile, mkdir } from "fs/promises"
import { existsSync } from "fs"
import * as path from "path"
import * as os from "os"
import type { Tool, ToolContext } from "./types.js"

const SECTION_HEADER = "## Memories"
const GLOBAL_MEMORY_PATH = path.join(os.homedir(), ".lop", "MEMORY.md")

function getProjectMemoryPath(cwd: string): string {
    return path.join(cwd, "MEMORY.md")
}

async function appendMemory(filePath: string, fact: string): Promise<void> {
    const dir = path.dirname(filePath)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })

    let content = ""
    if (existsSync(filePath)) {
        content = await readFile(filePath, "utf-8")
    }

    if (!content.includes(SECTION_HEADER)) {
        content = content.trimEnd() + (content ? "\n\n" : "") + SECTION_HEADER + "\n"
    }

    content = content.trimEnd() + "\n- " + fact + "\n"
    await writeFile(filePath, content, "utf-8")
}

export const saveMemoryTool: Tool = {
    name: "save_memory",
    description: `Save a fact or piece of information to persistent memory across sessions.
- scope=project saves to MEMORY.md in the current project directory
- scope=global saves to ~/.lop/MEMORY.md shared across all projects
- Memories are automatically loaded as context at session start
- Use for preferences, conventions, and important facts worth remembering`,
    parameters: z.object({
        fact: z.string().min(1).describe("The fact or information to remember"),
        scope: z.enum(["project", "global"]).default("project")
            .describe("Where to save: project (current repo) or global (all projects)"),
    }),

    async execute({ fact, scope }: { fact: string; scope: "project" | "global" }, ctx: ToolContext) {
        const cwd = (ctx as any).cwd ?? process.cwd()
        const filePath = scope === "global"
            ? GLOBAL_MEMORY_PATH
            : getProjectMemoryPath(cwd)

        await appendMemory(filePath, fact)
        return `Memory saved (${scope}): ${fact}`
    },
}

/** Load memories from MEMORY.md files to inject into system prompt */
export async function loadMemories(cwd: string): Promise<string | undefined> {
    const sources = [
        getProjectMemoryPath(cwd),
        GLOBAL_MEMORY_PATH,
    ]

    const sections: string[] = []
    for (const filePath of sources) {
        if (!existsSync(filePath)) continue
        try {
            const content = await readFile(filePath, "utf-8")
            const label = filePath.startsWith(cwd) ? "Project memories" : "Global memories"
            sections.push(`### ${label}\n${content.trim()}`)
        } catch {
            // ignore unreadable files
        }
    }

    if (sections.length === 0) return undefined
    return `# Persistent Memory\n\n${sections.join("\n\n")}`
}
```

- [ ] **Step 2: Register in ToolRegistry**

In `src/server/tools/index.ts`, add:
```typescript
import { saveMemoryTool } from "./memory.js"
// ...in constructor:
this.register(saveMemoryTool)
```

- [ ] **Step 3: Inject memories into system prompt in agent.ts**

In `src/server/agent.ts`, import `loadMemories` and add it only to the async system prompt assembly path used by `runLoop()`:

```typescript
import { loadMemories } from "./tools/memory.js"

// In runLoop(), add to systemParts AFTER BASE_SYSTEM_PROMPT:
const memoriesPrompt = await loadMemories(this.cwd)
const systemParts = [
    BASE_SYSTEM_PROMPT,
    memoriesPrompt,           // <-- after base prompt, before project instructions
    this.projectInstructions,
    await this.buildSubagentReminder(),
    this.buildSkillsPrompt(this.skills),
].filter((part): part is string => Boolean(part && part.trim()))
```

Do **not** modify `getContextInfo()` in v1. It is currently synchronous; memory-aware token accounting can be added later if needed.

- [ ] **Step 4: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 5: Commit**

```bash
git add src/server/tools/memory.ts src/server/tools/index.ts src/server/agent.ts
git commit -m "feat: add save_memory tool with project/global scope and auto-injection"
```

---

## Task 4: batch tool

**Files:** Create `src/server/tools/batch.ts`

- [ ] **Step 1: Create the tool**

```typescript
// src/server/tools/batch.ts
import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const MAX_BATCH = 10
const ALLOWED = new Set(["read", "glob", "grep", "listDirectory"])
const DISALLOWED = new Set(["batch"])

export function createBatchTool(getTools: () => Map<string, Tool>): Tool {
    return {
        name: "batch",
        description: `Execute multiple tool calls in parallel for efficiency.
- Use when operations are independent (reading multiple files, writing unrelated files)
- Do NOT use when operations depend on each other's results
- Cannot batch the batch tool itself
- Max ${MAX_BATCH} calls per batch`,
        parameters: z.object({
            tool_calls: z.array(z.object({
                tool: z.string().describe("Tool name to execute"),
                parameters: z.record(z.unknown()).describe("Parameters for the tool"),
            }))
            .min(1, "Provide at least one tool call")
            .max(MAX_BATCH, `Max ${MAX_BATCH} tool calls per batch`),
        }),

        async execute(
            { tool_calls }: { tool_calls: Array<{ tool: string; parameters: Record<string, unknown> }> },
            ctx: ToolContext,
        ) {
            const tools = getTools()
            const results = await Promise.all(
                tool_calls.map(async (call) => {
                    if (DISALLOWED.has(call.tool)) {
                        return { tool: call.tool, error: "batch cannot call itself" }
                    }
                    if (!ALLOWED.has(call.tool) || DISALLOWED.has(call.tool) || call.tool.startsWith("mcp__")) {
                        return { tool: call.tool, error: `tool not allowed in batch: ${call.tool}` }
                    }
                    const tool = tools.get(call.tool)
                    if (!tool) {
                        return { tool: call.tool, error: `unknown tool: ${call.tool}` }
                    }
                    try {
                        const parsed = tool.parameters.parse(call.parameters)
                        const result = await tool.execute(parsed, ctx)
                        return { tool: call.tool, result }
                    } catch (err: any) {
                        return { tool: call.tool, error: err?.message ?? String(err) }
                    }
                }),
            )

            const failed = results.filter(r => "error" in r).length
            const succeeded = results.length - failed
            const summary = `Batch: ${results.length} calls, ${succeeded} succeeded, ${failed} failed`
            const details = results.map(r =>
                "error" in r ? `[${r.tool}] ERROR: ${r.error}` : `[${r.tool}] OK`
            ).join("\n")

            return { content: `${summary}\n\n${details}` }
        },
    }
}
```

- [ ] **Step 2: Register in ToolRegistry**

The batch tool needs access to the registry's own tool map, so registration is slightly different.
In `src/server/tools/index.ts`:

```typescript
import { createBatchTool } from "./batch.js"

// After registering all other tools, add batch last:
this.register(createBatchTool(() => this.tools))
```

- [ ] **Step 3: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 4: Commit**

```bash
git add src/server/tools/batch.ts src/server/tools/index.ts
git commit -m "feat: add batch tool for parallel tool execution"
```

---

## Task 5: plan_mode

**Files:** Create `src/commands/builtin/planCommand.ts`; modify PermissionEngine, types, approval mode references, and built-in command registration.

### Step 1: Add "plan" to ApprovalMode everywhere

In `src/server/security/permissionEngine.ts`:
```typescript
export type ApprovalMode = "default" | "cautious" | "auto" | "plan"

// In check():
if (this.approvalMode === "plan") return this.planModeDefault(toolName)

private planModeDefault(toolName: string): PermissionLevel {
    // write and edit are always denied in plan mode
    if (toolName === "write" || toolName === "edit") return "deny"
    // bash delegates to BASH_RULES: catastrophic commands denied, read-only allowed
    if (toolName === "bash") return evaluateToolPolicy(toolName, {}, this.cwd)
    // all other tools (read, glob, grep, etc.) are allowed
    return "allow"
}
```

Update the union type in:
- `src/protocol/types.ts`: `approvalMode?: "default" | "cautious" | "auto" | "plan"`
- `src/client/index.ts`: `setApprovalMode(mode: "default" | "cautious" | "auto" | "plan")`
- `src/index.ts`: add `|| mode === 'plan'` to CLI check
- `src/server/index.ts`: update cast type
- `src/commands/builtin/approvalModeCommand.ts`: add "plan" to VALID_MODES, update help text

- [ ] **Step 2: Create /plan slash command**

```typescript
// src/commands/builtin/planCommand.ts
import { CommandKind, type SlashCommand } from "../types.js"

export const planCommand: SlashCommand = {
    name: "plan",
    description: "Enter plan mode — agent analyzes and plans without making changes",
    kind: CommandKind.BUILT_IN,

    action: (context) => {
        if (context.client) {
            context.client.setApprovalMode("plan").catch(() => {})
        }
        return {
            type: "message",
            content: "Plan mode activated. The agent will analyze and plan but cannot edit files.\nUse /approval-mode default to leave plan mode.",
        }
    },
}
```

- [ ] **Step 3: Register planCommand**

In `src/commands/builtin/index.ts`:
```typescript
import { planCommand } from "./builtin/planCommand.js"
// export it and add to allBuiltinCommands
```

- [ ] **Step 4: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run src/server/
```

- [ ] **Step 6: Commit**

```bash
git add src/commands/builtin/planCommand.ts \
        src/server/security/permissionEngine.ts \
        src/protocol/types.ts src/client/index.ts src/index.ts src/server/index.ts \
        src/commands/builtin/approvalModeCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add plan_mode with /plan command"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full build**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

- [ ] **Step 2: Run all tests**

```bash
npx vitest run src/server/
```

Expected: All existing tests pass. The new tools are pure additions — no regressions expected.

- [ ] **Step 3: Smoke test checklist**

- `webfetch`: Ask agent to fetch a public URL (e.g. https://example.com). Verify markdown output.
- `todowrite`: Ask agent to create a 3-step todo list. Verify `.lop/todos.json` created.
- `save_memory`: Ask agent to remember a preference. Verify `MEMORY.md` updated. Restart session and verify memory is injected.
- `batch`: Ask agent to read 3 files simultaneously. Verify batch tool called and all results returned. Verify a mutating tool is rejected inside batch.
- `plan_mode`: Run `/plan`, ask agent to analyze a task. Verify agent cannot edit files. Run `/approval-mode default`, verify mode switches.

---

## Implementation Notes

**Memory injection timing:**
`loadMemories()` is async. In v1, inject it only in the async `runLoop()` system prompt path. Do not make `getContextInfo()` async in this feature.

**batch + PermissionEngine:**
Sub-calls inside batch bypass the top-level permission hook. To keep v1 safe and low-complexity, batch is restricted to a read-only allowlist and explicitly rejects mutating tools and MCP tools.

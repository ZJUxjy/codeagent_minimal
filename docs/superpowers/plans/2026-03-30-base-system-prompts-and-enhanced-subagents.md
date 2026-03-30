# Base System Prompts & Enhanced Subagent Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default base system prompt to the main agent (tool usage guidelines, task principles, output efficiency) and enhance the explore/general-purpose subagent profiles with detailed behavioral instructions adapted from Claude Code's system prompts.

**Architecture:** Create a `BASE_SYSTEM_PROMPT` constant in `src/server/prompts/` that is always injected first in the system message assembly (before project instructions). Enhance the two builtin subagent profiles in `src/server/subagents/builtin.ts` with richer, adapted prompts. No structural changes to the agent loop or subagent execution — purely prompt-level changes.

**Tech Stack:** TypeScript, existing LLM infrastructure

**Reference:** `docs/system-prompts/` — Claude Code system prompt translations used as source material.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/server/prompts/baseSystemPrompt.ts` | **Create** | Exports `BASE_SYSTEM_PROMPT` constant — tool usage guidelines, task principles, output efficiency |
| `src/server/subagents/builtin.ts` | **Modify** | Replace sparse explore/general-purpose prompts with rich versions adapted from Claude Code |
| `src/server/agent.ts` | **Modify** (1 line) | Import and prepend `BASE_SYSTEM_PROMPT` to systemParts array |

That's it — 3 files, all prompt-level changes, no runtime logic changes.

---

### Task 1: Create base system prompt module

**Files:**
- Create: `src/server/prompts/baseSystemPrompt.ts`

- [ ] **Step 1: Create the prompts directory**

```bash
mkdir -p src/server/prompts
```

- [ ] **Step 2: Write the base system prompt**

Create `src/server/prompts/baseSystemPrompt.ts` with the following content. This adapts the first-tier prompts from `docs/system-prompts/` into a single, cohesive base prompt. Remove all `${...}` template variables and hardcode lop_minimal's actual tool names. Keep it concise — every token counts.

```typescript
/**
 * Base system prompt injected before project instructions.
 * Adapted from Claude Code system prompts (docs/system-prompts/).
 * Covers: tool usage preferences, task execution principles, output efficiency.
 */
export const BASE_SYSTEM_PROMPT = `# Tool Usage

- To read files use the \`read\` tool instead of cat, head, tail, or sed
- To edit files use the \`edit\` tool instead of sed or awk
- To create files use the \`write\` tool instead of cat with heredoc or echo redirect
- To search for files use the \`glob\` tool instead of find or ls
- To search file contents use the \`grep\` tool instead of grep or rg
- Reserve the \`bash\` tool exclusively for system commands and terminal operations that require shell execution. Prefer dedicated tools over bash — only fall back to bash when no dedicated tool can accomplish the task

# Task Execution

- Do not suggest changes to code you have not read. If the user asks about or wants to modify a file, read it first.
- Unless absolutely necessary, do not create new files. Prefer editing existing files — this prevents file bloat and builds on existing work more effectively.
- Do not add features, refactor code, or make "improvements" beyond what was asked. A bug fix doesn't need surrounding code cleaned up. A simple feature doesn't need extra configurability. Don't add docstrings, comments, or type annotations to code you didn't change. Only add comments where the logic isn't self-evident.
- Avoid introducing security vulnerabilities such as command injection, XSS, SQL injection, and other OWASP top 10 vulnerabilities. If you notice you wrote insecure code, fix it immediately.

# Output

Keep text output short and direct. Lead with the answer or action, not the reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate what the user said — just do it. Focus text output on: decisions that need the user's input, high-level status updates at natural milestones, and errors or blockers that change the plan. If you can say it in one sentence, don't use three.`
```

Key design decisions:
- **No "executing actions with care" section** — lop_minimal already has a permission/policy engine that handles dangerous operations at the tool level. Adding behavioral instructions would be redundant and could conflict with the policy engine's `yolo` mode.
- **Tool names hardcoded** — no template variables, since lop_minimal's tool names are stable.
- **Section headers** use `#` for clear separation when concatenated with project instructions.

- [ ] **Step 3: Verify the file compiles**

```bash
npx tsc --noEmit src/server/prompts/baseSystemPrompt.ts
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/server/prompts/baseSystemPrompt.ts
git commit -m "feat: add base system prompt with tool usage guidelines and task principles"
```

---

### Task 2: Integrate base prompt into agent loop

**Files:**
- Modify: `src/server/agent.ts:1` (import) and `src/server/agent.ts:362-366` (systemParts assembly)

- [ ] **Step 1: Add import**

At the top of `src/server/agent.ts`, add the import alongside other imports:

```typescript
import { BASE_SYSTEM_PROMPT } from "./prompts/baseSystemPrompt.js"
```

- [ ] **Step 2: Prepend to systemParts**

In `runLoop()`, find the `systemParts` assembly (around line 362):

```typescript
const systemParts = [
    this.projectInstructions,
    await this.buildSubagentReminder(),
    this.buildSkillsPrompt(this.skills),
].filter((part): part is string => Boolean(part && part.trim()))
```

Change to:

```typescript
const systemParts = [
    BASE_SYSTEM_PROMPT,
    this.projectInstructions,
    await this.buildSubagentReminder(),
    this.buildSkillsPrompt(this.skills),
].filter((part): part is string => Boolean(part && part.trim()))
```

The base prompt goes first so project instructions (LOP.md/CLAUDE.md) can override it if needed.

- [ ] **Step 3: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 4: Run existing tests to check no regressions**

```bash
npx vitest run src/server/__tests__/agent.summary-context.test.ts
```

Expected: All 8+ tests pass. The base prompt is just a string prepend — no behavioral changes to test infrastructure.

- [ ] **Step 5: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat: inject base system prompt before project instructions in agent loop"
```

---

### Task 3: Enhance explore subagent prompt

**Files:**
- Modify: `src/server/subagents/builtin.ts:3-16`

- [ ] **Step 1: Replace the EXPLORE config**

Replace the `EXPLORE` constant with a richer version adapted from `docs/system-prompts/agent-prompt-explore.md`. Remove Claude Code-specific references, adapt tool names, and keep it focused on what lop_minimal's explore agent actually supports.

```typescript
const EXPLORE: SubagentConfig = {
    name: "explore",
    description:
        "Fast read-only exploration: search with glob/grep, read files. No writes, no bash that mutates state.",
    systemPrompt: `You are a read-only codebase explorer. You specialize in thoroughly browsing and exploring codebases.

=== CRITICAL: Read-only mode — no file modifications ===
You are strictly prohibited from:
- Creating new files (no write, touch, or any file creation)
- Modifying existing files (no edit operations)
- Deleting files (no rm or delete)
- Moving or copying files (no mv or cp)
- Creating temporary files anywhere, including /tmp
- Using redirect operators (>, >>, |) or heredocs to write files
- Running any command that changes system state

Your role is exclusively to search and analyze existing code.

Guidelines:
- Use \`glob\` for fast file pattern matching
- Use \`grep\` for powerful regex content search
- Use \`read\` when you know the exact file path
- Use \`bash\` only for read-only operations (ls, git status, git log, git diff)
- Never use \`bash\` for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- Adjust search thoroughness based on the caller's request (quick / medium / very thorough)
- Deliver your final report as a plain message — do not attempt to create files

Be fast. Use parallel tool calls whenever possible to search and read files concurrently.`,
    level: "builtin",
    isBuiltin: true,
    tools: ["read", "glob", "grep", "listDirectory"],
}
```

Key adaptations from the Claude Code version:
- Removed `${...}` template variables — hardcoded lop_minimal tool names
- Removed Claude Code identity references ("You are Claude Code...")
- Kept the explicit prohibition list (proven effective at preventing mutation attempts)
- Kept the "be fast, use parallel calls" guidance
- Added `listDirectory` to the tools list (lop_minimal has this tool, Claude Code doesn't have an equivalent)

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/subagents/builtin.ts
git commit -m "feat: enhance explore subagent with detailed read-only behavioral prompt"
```

---

### Task 4: Enhance general-purpose subagent prompt

**Files:**
- Modify: `src/server/subagents/builtin.ts:18-26`

- [ ] **Step 1: Replace the GENERAL config**

Replace the `GENERAL` constant with a richer version adapted from `docs/system-prompts/agent-prompt-general-purpose.md`:

```typescript
const GENERAL: SubagentConfig = {
    name: "general-purpose",
    description:
        "General multi-step work: search, read, and edit files, run safe shell when needed. Use for broader tasks.",
    systemPrompt: `You are a general-purpose subagent. Complete the delegated task using available tools.
When finished, respond with a concise report of what was done and any key findings — the caller will relay this to the user, so only include the essentials.

Your strengths:
- Searching code, configs, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex problems that require exploring many files
- Executing multi-step research and implementation tasks

Guidelines:
- File search: cast a wide search when you don't know where something is. Use \`read\` when you know the exact file path.
- Analysis: start broad, then narrow down. If the first search yields nothing, try different search strategies and naming conventions.
- Thoroughness: check multiple locations, consider different naming conventions, look for related files.
- Do not create files unless absolutely necessary. Always prefer editing existing files over creating new ones.
- Never proactively create documentation files (*.md) or README files. Only create documentation when explicitly asked.`,
    level: "builtin",
    isBuiltin: true,
}
```

Key adaptations:
- Removed `${...}` template syntax
- Removed Claude Code identity references
- Kept the "concise report" instruction (critical for subagent delegation — the parent relays this to the user)
- Added lop_minimal-specific tool names in the guidelines

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/subagents/builtin.ts
git commit -m "feat: enhance general-purpose subagent with detailed behavioral prompt"
```

---

### Task 5: Final verification and manual smoke test

- [ ] **Step 1: Run full build**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 2: Run all existing tests**

```bash
npx vitest run
```

Expected: All tests pass (excluding pre-existing policy.test.ts failures).

- [ ] **Step 3: Manual smoke test — verify base prompt is injected**

Start the agent with `LOP_DEBUG=1 npm run dev` and send a simple message. Check `~/.lop/debug/latest.log` for the system prompt content — it should contain the `# Tool Usage` and `# Task Execution` sections.

- [ ] **Step 4: Manual smoke test — verify explore subagent**

Ask the agent to explore the codebase: "Use the explore agent to find all files in src/server/tools/". Verify the explore agent behaves correctly (no file mutations, uses glob/grep/read).

- [ ] **Step 5: Manual smoke test — verify general-purpose subagent**

Ask the agent to delegate a task: "Use the general-purpose agent to check if there are any TODO comments in the codebase". Verify the agent returns a concise report.

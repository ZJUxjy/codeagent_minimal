# Project Instruction Files — Development Plan

**Date:** 2026-03-29
**Scope:** Load `LOP.md` / `CLAUDE.md` / `AGENTS.md` from the project tree and inject into system prompt, giving users a persistent way to set project-specific instructions for the agent.

---

## What We're Building

A lightweight version of qwen-code's hierarchical memory system. When the agent starts, it walks up the directory tree from `cwd` to the git root, collects instruction files, and prepends them to the system prompt. The model sees the instructions on every turn without the user having to repeat themselves.

**Example use:** A project's `LOP.md` says "Always use TypeScript strict mode. Prefer `const` over `let`. Never use `any`." — the agent follows these rules automatically throughout the session.

---

## Scope vs. qwen-code

We intentionally implement a simpler subset:

| Feature | qwen-code | Our v1 |
|---|---|---|
| File names | QWEN.md, AGENTS.md, configurable | LOP.md, CLAUDE.md, AGENTS.md |
| Directory search | Global ~/.qwen/ + upward to .git | Upward to .git only |
| Global user file | `~/.qwen/QWEN.md` | `~/.lop/instructions.md` |
| Sub-directory files | Not loaded unless CWD changes | Same |
| `@import` syntax | Full tree/flat import modes | **Not in v1** |
| Hot-reload / watch | Manual refresh command | **Not in v1** |
| `/init` command | Generates QWEN.md via LLM | **Not in v1** |
| Folder trust model | Configurable | Always trusted (single-user tool) |
| File size limit | None (LLM token limit) | 50 KB hard cap per file |

---

## Architecture

```
Agent.runLoop()
      │
      ▼
loadProjectInstructions(cwd)        ← new function in src/server/instructions/
      │
   1. Walk cwd → git root, collect LOP.md / CLAUDE.md / AGENTS.md
   2. Also check ~/.lop/instructions.md (global)
   3. Read + concatenate with path markers
      │
      ▼
string | undefined                  ← injected into systemParts[]

systemParts = [
  projectInstructions,              ← FIRST — highest contextual priority
  subagentReminder,
  skillsPrompt,
].filter(Boolean).join("\n\n")
```

Instructions go **first** in the system prompt — the model reads them before skill and subagent reminders, matching how Claude Code handles `CLAUDE.md`.

---

## Phase 1: Discovery and Loading

### 1.1 File names and search order

```typescript
// src/server/instructions/loader.ts

const INSTRUCTION_FILENAMES = ["LOP.md", "CLAUDE.md", "AGENTS.md"]

// Per-directory: return the first matching file found (LOP.md wins over CLAUDE.md wins over AGENTS.md)
// Rationale: one file per directory; if you have both LOP.md and CLAUDE.md, only LOP.md is loaded
```

Search locations (highest priority last — appended last = read last by model):

1. `~/.lop/instructions.md` — global user instructions (always loaded)
2. Files from git root down to cwd (ancestor-first order)

### 1.2 Discovery algorithm

```typescript
export async function loadProjectInstructions(cwd: string): Promise<string | undefined> {
    const files: { path: string; content: string }[] = []

    // 1. Global user file
    const globalPath = path.join(os.homedir(), ".lop", "instructions.md")
    const globalContent = await tryReadFile(globalPath)
    if (globalContent) files.push({ path: globalPath, content: globalContent })

    // 2. Upward traversal from cwd to git root
    const gitRoot = findGitRoot(cwd)   // reuse from skills/loader.ts
    const dirs = collectDirsFromRootToCwd(gitRoot ?? cwd, cwd)  // ancestor-first
    for (const dir of dirs) {
        for (const name of INSTRUCTION_FILENAMES) {
            const filePath = path.join(dir, name)
            const content = await tryReadFile(filePath)
            if (content) {
                files.push({ path: filePath, content })
                break  // one file per directory
            }
        }
    }

    if (files.length === 0) return undefined
    return formatInstructions(files)
}
```

### 1.3 Formatting

Each file wrapped with a path comment so the model knows where instructions came from:

```
# Project Instructions

<!-- Source: /home/alice/.lop/instructions.md -->
Always write tests before implementation.

<!-- Source: /home/alice/projects/myapp/LOP.md -->
This is a Next.js 14 project using the App Router.
Use Tailwind CSS for all styling. Never use inline styles.
```

A single `# Project Instructions` header at the top; files separated by a blank line. No `---` fences — those get confused with markdown horizontal rules in the model's rendering.

### 1.4 Safety

- **50 KB per file hard cap** — files over 50 KB are truncated with a warning appended: `<!-- truncated: file exceeded 50KB limit -->`
- **Missing files** — silently skipped (`ENOENT` ignored, other errors logged at debug level)
- **Empty files** — skipped
- **`findGitRoot`** — reuse the existing function from `src/server/skills/loader.ts` (DRY)
- **`collectDirsFromRootToCwd`** — collect all directories from git root down to cwd, inclusive

**Files:** `src/server/instructions/loader.ts`, `src/server/instructions/index.ts`

---

## Phase 2: Agent Integration

### 2.1 Pass instructions through AgentConfig

```typescript
// src/server/agent.ts
export interface AgentConfig {
    // ... existing fields
    projectInstructions?: string   // pre-loaded instruction content
}
```

### 2.2 Inject into systemParts

```typescript
// In runLoop():
const systemParts = [
    this.config.projectInstructions,   // ← first
    await this.buildSubagentReminder(),
    this.buildSkillsPrompt(this.skills),
].filter((part): part is string => Boolean(part && part.trim()))
```

### 2.3 Load in server/index.ts alongside skills

```typescript
// In the initialize handler:
const [skillResult, projectInstructions] = await Promise.all([
    loadSkills(currentCwd),
    loadProjectInstructions(currentCwd),
])

agent = new Agent({
    ...config,
    skills: skillResult.skills,
    projectInstructions,
    questionBridge,
    hooks: { beforeToolExecute: permissionHook },
})
```

Also reload on cwd change (same pattern as skills).

**Files:** `src/server/agent.ts`, `src/server/index.ts`

---

## Phase 3: `/instructions` Slash Command

Show what instruction files are currently loaded, so users can debug "why is the agent behaving this way."

```
/instructions          — show loaded instruction files and their sources
```

Output example:

```
Project instructions: 2 file(s) loaded

  ~/.lop/instructions.md          (842 chars)
  ~/projects/myapp/LOP.md         (1.2 KB)

Total: 2.0 KB injected into system prompt.
Run /instructions to refresh after editing files.
```

The command re-runs `loadProjectInstructions(cwd)` to get the current state (not cached) and displays the source paths with sizes.

**Note:** No hot-reload on file change — users must restart or use `/instructions` to see updated content in the next message. (The agent is already mid-session; updating mid-turn would be confusing.)

**Files:** `src/commands/builtin/instructionsCommand.ts`, `src/commands/builtin/index.ts`

---

## Phase 4: `lop init` — Scaffold LOP.md

A subcommand to create a starter `LOP.md` in the current directory:

```bash
lop init
```

If `LOP.md` already exists, print a message and exit (no overwrite). Otherwise create:

```markdown
# Project Instructions

<!-- Add project-specific instructions for the AI agent here. -->
<!-- This file is loaded automatically from any directory in the project tree. -->

## Code Style
<!-- e.g. "Always use TypeScript strict mode." -->

## Architecture
<!-- e.g. "This is a Next.js App Router project." -->

## Rules
<!-- e.g. "Never commit secrets. Always write tests." -->
```

Simple static template — no LLM call to generate content (unlike qwen-code's `/init` command). The user fills it in.

**Files:** `src/index.ts` (add `init` subcommand check before TUI launch)

---

## Implementation Order

| Phase | Effort | Value | Priority |
|---|---|---|---|
| 1 — Discovery + loading | S (2h) | Core | **P0** |
| 2 — Agent integration | S (1h) | Core | **P0** |
| 3 — `/instructions` command | S (1h) | High | **P1** |
| 4 — `lop init` scaffold | S (1h) | Medium | **P1** |

Phases 1–2 are the full MVP. The feature is immediately usable once the loader and agent integration are in place.

---

## Key Reuse from Existing Code

| New need | Reuse from |
|---|---|
| `findGitRoot(dir)` | `src/server/skills/loader.ts` — export and import |
| `tryReadFile()` pattern | Similar to skill loader's file reading with `ENOENT` guard |
| `loadSkills()` parallel load pattern | `server/index.ts` — replicate `Promise.all` pattern |
| Slash command structure | Any existing command in `src/commands/builtin/` |

`findGitRoot` specifically should be **moved to a shared utility** (`src/server/utils/git.ts`) since both the skill loader and instruction loader need it.

---

## File Structure After Implementation

```
src/server/instructions/
  loader.ts        ← loadProjectInstructions(), collectDirsFromRootToCwd()
  index.ts         ← re-export

src/server/utils/
  git.ts           ← findGitRoot() (moved from skills/loader.ts)

src/commands/builtin/
  instructionsCommand.ts   ← /instructions command
```

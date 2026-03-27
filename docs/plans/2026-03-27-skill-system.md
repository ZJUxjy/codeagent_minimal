# Skill System — Development Plan

**Date:** 2026-03-27
**Reference:** [pi-mono skill system](https://github.com/badlogic/pi-mono)

---

## Design Principles

- **Progressive disclosure:** Skill descriptions stay in the system prompt permanently; full content loads on-demand via the existing `read` tool — no token waste.
- **Filesystem as registry:** Dropping a directory with a `SKILL.md` is all it takes to register a skill — no runtime registration step.
- **Zero new dependencies:** Plain frontmatter parser, no extra packages.

---

## Phase 1 — Skill Loader

**New:** `src/server/skills/`

```
src/server/skills/
├── types.ts      # Skill data structures
├── loader.ts     # Discovery + SKILL.md parsing
└── index.ts      # Public exports
```

### `types.ts`

```typescript
export interface Skill {
  name: string
  description: string
  filePath: string               // Absolute path to SKILL.md
  baseDir: string                // Parent directory (relative path anchor)
  disableModelInvocation: boolean
}

export interface SkillLoadResult {
  skills: Skill[]
  diagnostics: string[]          // Warnings; never block loading
}
```

### `loader.ts`

**Discovery paths** (lowest → highest priority):

| Path | Scope |
|---|---|
| `~/.lop/skills/` | Global user skills |
| `<git-root>/.lop/skills/` | Project-level skills (walks up to git root) |
| `config.skills.paths[]` | Custom paths from config file |

**Rules:**
- A subdirectory containing `SKILL.md` is one skill package.
- `name` must match the parent directory name (warn if not, still load).
- Missing `description` → skip skill entirely (record diagnostic).
- Same-name collision → first discovered wins (record diagnostic).
- Frontmatter parser handles only three fields: `name`, `description`, `disable-model-invocation`. Unknown fields ignored.

---

## Phase 2 — Config Integration

**Modified:** `src/config.ts`

Add optional field to `LopConfig`:

```typescript
skills?: {
  paths?: string[]     // Additional skill directories
}
```

Environment variable: `LOP_SKILLS_PATHS` (comma-separated paths).

---

## Phase 3 — System Prompt Injection

**Modified:** `src/server/agent.ts`

New method `buildSkillsPrompt(skills: Skill[]): string`.
Only includes skills where `disableModelInvocation === false`.

```
The following skills provide specialized instructions for specific tasks.
Use the read tool to load a skill when the task matches its description.
When a skill references relative paths, resolve them against the skill directory.

<available_skills>
  <skill>
    <name>brave-search</name>
    <description>Web search via Brave Search API...</description>
    <location>/abs/path/to/brave-search/SKILL.md</location>
  </skill>
</available_skills>
```

Merged with the existing `buildSubagentReminder()` output before injection in `runLoop()`.

**Model trigger flow:**
1. Model reads skill descriptions in system prompt.
2. Determines current task matches a skill.
3. Calls `read` tool on the `<location>` path.
4. Follows instructions in the loaded SKILL.md.

No new tools required — `read` already exists.

---

## Phase 4 — Slash Commands

**New:** `src/commands/builtin/skillCommand.ts`

### `/skills` — list loaded skills

```
Found 3 skill(s):
  brave-search   — Web search via Brave API
  pdf-tools      — PDF processing and extraction
  git-helper     — Git workflow automation  [manual-only]
```

### `/skill <name> [args]` — manual invocation

Triggers any skill by name, including those with `disable-model-invocation: true`.
Constructs a `submit_prompt` action to send to the agent with the skill content prepended.

Register both in `allBuiltinCommands`.

---

## Phase 5 — Agent Wiring

**Modified:** `src/server/index.ts`

In the `initialize` RPC handler:
1. Call `loadSkills(cwd, config)`.
2. Pass result to the `Agent` constructor.

`Agent.runLoop()` uses the loaded skills to build the system prompt fragment — no other changes to the execution loop.

---

## Deliverables

| File | Change | Purpose |
|---|---|---|
| `src/server/skills/types.ts` | New | Data structures |
| `src/server/skills/loader.ts` | New | Discovery + parsing |
| `src/server/skills/index.ts` | New | Public exports |
| `src/server/skills/loader.test.ts` | New | Unit tests |
| `src/config.ts` | Modify | Add `skills.paths` field |
| `src/server/agent.ts` | Modify | System prompt injection |
| `src/server/index.ts` | Modify | Load skills on initialize |
| `src/commands/builtin/skillCommand.ts` | New | `/skills` + `/skill` commands |
| `src/commands/builtin/index.ts` | Modify | Register skill commands |

---

## Implementation Order

```
Phase 1 (types + loader)
    ↓
Phase 3 (system prompt injection)     ← core path: discover → inject → model loads
    ↓
Phase 2 (config integration)
    ↓
Phase 5 (index.ts wiring)
    ↓
Phase 4 (slash commands) + tests
```

Get the core chain working first (discover → inject → model reads via `read` tool), then layer on the user-facing commands.

# Skills System Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the lop_minimal skills system based on research of Codex, Claude Code, OpenClaw, OpenCode, and Qwen-Code — making skills first-class LLM-callable tools, adding cross-agent compatibility, token budget management, auto-registered slash commands, and file watcher hot-reload.

**Architecture:** The current system discovers skills from filesystem directories and injects their metadata into the system prompt as XML. The LLM must then use the `read` tool to load SKILL.md content. The optimization adds a dedicated `skill` tool (OpenCode/Qwen-Code pattern) so the LLM can directly invoke skills, adds `.agents/skills/` paths for cross-agent compatibility, implements token budget management for the skills prompt section, auto-registers each skill as a `/skill-name` command, and adds chokidar-based file watching for hot-reload.

**Tech Stack:** TypeScript, Zod, chokidar (for file watching), existing Vercel AI SDK patterns

**Reference:** Research findings are documented in conversation context. Key comparisons:

| Feature | Codex | Claude Code | OpenClaw | OpenCode | Qwen-Code | lop_minimal (current) |
|---------|-------|-------------|----------|----------|-----------|----------------------|
| Skill tool for LLM | ❌ (system prompt only) | ❌ (read tool) | ❌ (read tool) | ✅ | ✅ | ❌ |
| `.agents/skills/` | ✅ | ❌ | ✅ | ✅ | ✅ | ❌ |
| Token budget | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Auto-register commands | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| File watcher | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |

---

## File Structure

| File | Responsibility | Status |
|------|---------------|--------|
| `src/server/skills/types.ts` | Skill interface + `SkillPromptOptions` type | Modify |
| `src/server/skills/loader.ts` | Discovery, frontmatter parsing, loading | Modify |
| `src/server/tools/skill.ts` | **New** — `skill` tool for LLM invocation | Create |
| `src/server/tools/index.ts` | ToolRegistry — register skill tool | Modify |
| `src/server/agent.ts` | Agent — skill tool wiring, token budget, updateSkills | Modify |
| `src/server/skills/watcher.ts` | **New** — File watcher for skill hot-reload | Create |
| `src/server/index.ts` | Server — wire watcher lifecycle | Modify |
| `src/commands/loaders/SkillCommandLoader.ts` | **New** — Dynamic skill command loader | Create |
| `src/commands/types.ts` | Add `CommandKind.SKILL` | Modify |
| `src/commands/CommandRegistry.ts` | Add public `mergeCommands` method | Modify |
| `src/tui/hooks/useSlashCommandProcessor.ts` | Wire skill loader with useEffect | Modify |
| `src/server/skills/__tests__/skillTool.test.ts` | **New** — Skill tool tests | Create |
| `src/server/skills/__tests__/budget.test.ts` | **New** — Token budget tests | Create |
| `src/server/skills/__tests__/watcher.test.ts` | **New** — Watcher tests | Create |
| `src/server/skills/loader.test.ts` | Add `.agents/skills/` test | Modify |

---

## Task 1: Skill Tool for LLM Invocation

**Why:** The biggest gap. Currently the LLM sees skill metadata in the system prompt and must use the generic `read` tool to load SKILL.md. A dedicated `skill` tool (OpenCode/Qwen-Code pattern) lets the LLM directly invoke skills with proper context injection.

**Files:**
- Create: `src/server/tools/skill.ts`
- Modify: `src/server/tools/index.ts`
- Test: `src/server/skills/__tests__/skillTool.test.ts`

- [ ] **Step 1: Write the test for the skill tool**

```typescript
// src/server/skills/__tests__/skillTool.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFile } from "fs/promises"

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
}))

import { createSkillTool } from "../../tools/skill.js"
import type { Skill } from "../types.js"

const mockSkills: Skill[] = [
    {
        name: "code-review",
        description: "Review code for quality and security",
        filePath: "/home/user/.lop/skills/code-review/SKILL.md",
        baseDir: "/home/user/.lop/skills/code-review",
        disableModelInvocation: false,
    },
    {
        name: "deploy",
        description: "Deploy to production",
        filePath: "/home/user/.lop/skills/deploy/SKILL.md",
        baseDir: "/home/user/.lop/skills/deploy",
        disableModelInvocation: true,
    },
]

describe("skill tool", () => {
    it("should have correct name and description", () => {
        const tool = createSkillTool(mockSkills)
        expect(tool.name).toBe("skill")
        expect(tool.description).toContain("code-review")
        expect(tool.description).not.toContain("deploy") // disableModelInvocation
    })

    it("should load skill content and return it", async () => {
        const mockContent = "---\nname: code-review\n---\n## Instructions\nReview code."
        vi.mocked(readFile).mockResolvedValue(mockContent)

        const tool = createSkillTool(mockSkills)
        const result = await tool.execute(
            { name: "code-review" },
            { cwd: "/project" }
        )
        expect(result).toContain("<skill_content")
        expect(result).toContain("Review code.")
    })

    it("should return error for unknown skill", async () => {
        const tool = createSkillTool(mockSkills)
        const result = await tool.execute(
            { name: "nonexistent" },
            { cwd: "/project" }
        )
        expect(result).toContain("not found")
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/skills/__tests__/skillTool.test.ts`
Expected: FAIL — `createSkillTool` not found

- [ ] **Step 3: Implement the skill tool**

```typescript
// src/server/tools/skill.ts
import { z } from "zod"
import { readFile } from "fs/promises"
import type { Tool, ToolContext } from "./types.js"
import type { Skill } from "../skills/types.js"

/**
 * Create a `skill` tool that allows the LLM to load skill content on demand.
 * Only skills without `disableModelInvocation` are available.
 */
export function createSkillTool(skills: Skill[]): Tool {
    const available = skills.filter((s) => !s.disableModelInvocation)

    const skillList = available
        .map((s) => `  - ${s.name}: ${s.description}`)
        .join("\n")

    return {
        name: "skill",
        description: [
            "Load a skill's full instructions by name.",
            "Available skills:",
            skillList,
        ].join("\n"),

        parameters: z.object({
            name: z.string().describe("The skill name to load"),
        }),

        async execute(
            { name }: { name: string },
            _ctx: ToolContext,
        ): Promise<string> {
            const skill = available.find(
                (s) => s.name.toLowerCase() === name.toLowerCase(),
            )
            if (!skill) {
                const validNames = available.map((s) => s.name).join(", ")
                return `Skill '${name}' not found. Available: ${validNames}`
            }

            try {
                const content = await readFile(skill.filePath, "utf8")
                return [
                    `<skill_content name="${skill.name}" path="${skill.filePath}">`,
                    content,
                    "</skill_content>",
                ].join("\n")
            } catch (err: any) {
                return `Error loading skill '${skill.name}': ${err.message}`
            }
        },
    }
}
```

- [ ] **Step 4: Register the skill tool in ToolRegistry**

In `src/server/tools/index.ts`, add import and a `skills` parameter:

```typescript
// Add to imports
import { createSkillTool } from "./skill.js"
import type { Skill } from "../skills/types.js"

// Add to ToolRegistryOptions
export interface ToolRegistryOptions {
    mcpServers?: Record<string, McpServerConfig>
    skipDefaultTools?: boolean
    skills?: Skill[]  // NEW
}

// In constructor, after default tools registration:
if (options.skills && options.skills.length > 0) {
    this.register(createSkillTool(options.skills))
}
```

- [ ] **Step 5: Pass skills through from Agent**

In `src/server/agent.ts`, pass skills to ToolRegistry constructor:

```typescript
// In constructor, change ToolRegistry creation:
const registryOptions: ToolRegistryOptions = {
    ...(config.mcpConfig?.mcpServers ? { mcpServers: config.mcpConfig.mcpServers } : {}),
    skills: config.skills,
}
this.tools = config.tools ?? new ToolRegistry(registryOptions)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/server/skills/__tests__/skillTool.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/tools/skill.ts src/server/skills/__tests__/skillTool.test.ts src/server/tools/index.ts src/server/agent.ts
git commit -m "feat: add skill tool for LLM-initiated skill loading"
```

---

## Task 2: Cross-Agent Compatibility (`.agents/skills/`)

**Why:** Codex, OpenClaw, OpenCode, and Qwen-Code all scan `.agents/skills/` directories. Adding this path makes lop_minimal compatible with skills shared across different agents.

**Files:**
- Modify: `src/server/skills/loader.ts:74-99` (buildDiscoveryPaths)
- Test: `src/server/skills/loader.test.ts`

- [ ] **Step 1: Write the test**

Add to `src/server/skills/loader.test.ts`. Uses `loadSkills()` (the exported function) since `buildDiscoveryPaths` is private:

```typescript
it("discovers skills from .agents/skills/ directories", async () => {
    // Project-level .agents/skills/
    const agentsSkillDir = path.join(projectDir, ".agents", "skills", "agents-skill")
    await fs.mkdir(agentsSkillDir, { recursive: true })
    await fs.writeFile(
        path.join(agentsSkillDir, "SKILL.md"),
        `---\nname: agents-skill\ndescription: From .agents directory\n---\n`,
        "utf8",
    )

    // Global ~/.agents/skills/
    const globalAgentsDir = path.join(homeDir, ".agents", "skills", "global-agents-skill")
    await fs.mkdir(globalAgentsDir, { recursive: true })
    await fs.writeFile(
        path.join(globalAgentsDir, "SKILL.md"),
        `---\nname: global-agents-skill\ndescription: From global .agents\n---\n`,
        "utf8",
    )

    const result = await loadSkills(projectDir)

    expect(result.skills.map((s) => s.name)).toContain("agents-skill")
    expect(result.skills.map((s) => s.name)).toContain("global-agents-skill")
})

it("prioritizes .lop/skills over .agents/skills on name collision", async () => {
    // Same skill name in both .lop/skills and .agents/skills
    const lopDir = path.join(projectDir, ".lop", "skills", "shared")
    await fs.mkdir(lopDir, { recursive: true })
    await fs.writeFile(
        path.join(lopDir, "SKILL.md"),
        `---\nname: shared\ndescription: From .lop (higher priority)\n---\n`,
        "utf8",
    )

    const agentsDir = path.join(projectDir, ".agents", "skills", "shared")
    await fs.mkdir(agentsDir, { recursive: true })
    await fs.writeFile(
        path.join(agentsDir, "SKILL.md"),
        `---\nname: shared\ndescription: From .agents (lower priority)\n---\n`,
        "utf8",
    )

    const result = await loadSkills(projectDir)

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0].description).toBe("From .lop (higher priority)")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/skills/loader.test.ts -t "discovers skills from .agents"`
Expected: FAIL

- [ ] **Step 3: Add `.agents/skills/` discovery paths**

In `src/server/skills/loader.ts`, modify `buildDiscoveryPaths`:

```typescript
function buildDiscoveryPaths(cwd: string, config?: LopConfig): string[] {
    const paths: string[] = []

    // Custom paths (highest priority)
    const envPaths = (process.env.LOP_SKILLS_PATHS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    const configPaths = config?.skills?.paths ?? []
    for (const customPath of [...envPaths, ...configPaths]) {
        paths.push(path.resolve(cwd, customPath))
    }

    // Project-level skills (.lop/skills has priority over .agents/skills)
    const gitRoot = findGitRoot(cwd)
    if (gitRoot) {
        paths.push(path.join(gitRoot, ROOT_DIR, SKILLS_DIR))
        paths.push(path.join(gitRoot, ".agents", SKILLS_DIR))  // NEW
    }

    // Global user skills (~/.lop/skills has priority over ~/.agents/skills)
    paths.push(path.join(os.homedir(), ROOT_DIR, SKILLS_DIR))
    paths.push(path.join(os.homedir(), ".agents", SKILLS_DIR))  // NEW

    return Array.from(new Set(paths))
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/server/skills/loader.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/skills/loader.ts src/server/skills/loader.test.ts
git commit -m "feat: add .agents/skills/ discovery paths for cross-agent compatibility"
```

---

## Task 3: Token Budget Management for Skills Prompt

**Why:** OpenClaw implements token budgets — when there are many skills, the full XML listing could overflow context. Auto-downgrade to compact format (name + location only) when the prompt exceeds a threshold.

**Files:**
- Modify: `src/server/skills/types.ts` — add `SkillPromptOptions`
- Modify: `src/server/agent.ts` — update `buildSkillsPrompt`

- [ ] **Step 1: Define budget types**

In `src/server/skills/types.ts`, add:

```typescript
export interface SkillPromptOptions {
    /** Maximum characters for the skills prompt section. Default: 3000 */
    maxChars?: number
}
```

- [ ] **Step 2: Implement budget-aware prompt builder**

In `src/server/agent.ts`, update `buildSkillsPrompt`:

```typescript
private buildSkillsPrompt(
    skills: Skill[],
    opts?: SkillPromptOptions,
): string | undefined {
    const enabled = skills.filter((skill) => !skill.disableModelInvocation)
    if (enabled.length === 0) return undefined

    const maxChars = opts?.maxChars ?? 3000

    // Full format: name + description + location
    const fullItems = enabled.map((skill) => [
        "  <skill>",
        `    <name>${Agent.escapeXml(skill.name)}</name>`,
        `    <description>${Agent.escapeXml(skill.description)}</description>`,
        `    <location>${skill.filePath}</location>`,
        "  </skill>",
    ].join("\n"))

    const header = [
        "The following skills provide specialized instructions for specific tasks.",
        "You have a `skill` tool to load the full instructions when the task matches.",
        "When a skill references relative paths, resolve them against the skill directory.",
        "",
        "<available_skills>",
    ].join("\n")

    const fullBody = `${header}\n${fullItems.join("\n")}\n</available_skills>`
    if (fullBody.length <= maxChars) return fullBody

    // Compact format: name + location only (no description)
    const compactItems = enabled.map((skill) => [
        "  <skill>",
        `    <name>${Agent.escapeXml(skill.name)}</name>`,
        `    <location>${skill.filePath}</location>`,
        "  </skill>",
    ].join("\n"))

    const compactBody = `${header}\n${compactItems.join("\n")}\n</available_skills>`
    if (compactBody.length <= maxChars) return compactBody

    // Truncate: keep as many skills as fit
    const truncated = compactItems.slice(
        0,
        Math.floor(enabled.length * maxChars / compactBody.length),
    )
    return [
        header,
        truncated.join("\n"),
        `  <!-- ${enabled.length - truncated.length} more skills omitted (budget exceeded) -->`,
        "</available_skills>",
    ].join("\n")
}
```

- [ ] **Step 3: Write budget tests**

Create `src/server/skills/__tests__/budget.test.ts`. Tests the prompt builder directly by extracting it to a testable function:

```typescript
// src/server/skills/__tests__/budget.test.ts
import { describe, it, expect } from "vitest"
import { buildSkillsPromptSection } from "../loader.js"
import type { Skill } from "../types.js"

const makeSkill = (name: string, descLength: number): Skill => ({
    name,
    description: "x".repeat(descLength),
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    disableModelInvocation: false,
})

describe("buildSkillsPromptSection (token budget)", () => {
    it("uses full format when under budget", () => {
        const skills = [makeSkill("a", 50), makeSkill("b", 50)]
        const result = buildSkillsPromptSection(skills, { maxChars: 5000 })
        expect(result).toContain("<description>")
        expect(result).toContain("</available_skills>")
    })

    it("uses compact format (no description) when full exceeds budget", () => {
        const skills = Array.from({ length: 100 }, (_, i) => makeSkill(`skill-${i}`, 200))
        const result = buildSkillsPromptSection(skills, { maxChars: 3000 })
        expect(result).not.toContain("<description>")
        expect(result).toContain("<name>")
    })

    it("truncates skills when even compact exceeds budget", () => {
        const skills = Array.from({ length: 500 }, (_, i) => makeSkill(`s-${i}`, 100))
        const result = buildSkillsPromptSection(skills, { maxChars: 500 })
        expect(result).toContain("more skills omitted")
    })

    it("returns undefined when no enabled skills", () => {
        const skills = [makeSkill("a", 10)]
        skills[0].disableModelInvocation = true
        const result = buildSkillsPromptSection(skills)
        expect(result).toBeUndefined()
    })
})
```

This requires extracting `buildSkillsPromptSection` from `Agent.buildSkillsPrompt` into `loader.ts` as an exported function. In `agent.ts`, replace the private method with a call to the extracted function.

- [ ] **Step 4: Run budget tests**

Run: `npx vitest run src/server/skills/__tests__/budget.test.ts`
Expected: PASS

- [ ] **Step 5: Run all tests + build**

Run: `npx vitest run && npm run build`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/server/skills/types.ts src/server/skills/loader.ts src/server/skills/__tests__/budget.test.ts src/server/agent.ts
git commit -m "feat: add token budget management for skills system prompt"
```

---

## Task 4: Auto-Register Skills as Slash Commands

**Why:** OpenCode and Qwen-Code automatically register each discovered skill as a `/skill-name` command, so users can invoke them directly without typing `/skill <name>`.

**Files:**
- Create: `src/commands/loaders/SkillCommandLoader.ts`
- Modify: `src/commands/types.ts` — add `CommandKind.SKILL`
- Modify: `src/tui/hooks/useSlashCommandProcessor.ts` — wire dynamic loader
- Modify: `src/server/index.ts` — pass loaded skills to command processor

- [ ] **Step 1: Add SKILL command kind**

In `src/commands/types.ts`, add to the `CommandKind` enum:

```typescript
export enum CommandKind {
    BUILT_IN = 'built-in',
    SKILL = 'skill',       // NEW
}
```

- [ ] **Step 2: Create SkillCommandLoader**

```typescript
// src/commands/loaders/SkillCommandLoader.ts
import type { SlashCommand, SlashCommandActionReturn, CommandContext } from "../types.js"
import { CommandKind } from "../types.js"
import { loadSkills } from "../../server/skills/index.js"

export class SkillCommandLoader {
    private cachedCommands: SlashCommand[] = []
    private cwd: string

    constructor(cwd: string) {
        this.cwd = cwd
    }

    async loadCommands(): Promise<SlashCommand[]> {
        const { skills } = await loadSkills(this.cwd)

        this.cachedCommands = skills.map((skill): SlashCommand => ({
            name: skill.name,
            description: skill.description,
            kind: CommandKind.SKILL,
            hidden: skill.disableModelInvocation,
            action: async (
                _context: CommandContext,
                args: string,
            ): Promise<SlashCommandActionReturn> => {
                const { readFile } = await import("fs/promises")
                const skillContent = await readFile(skill.filePath, "utf8")
                const task = args.trim() || `Apply the ${skill.name} skill.`
                return {
                    type: "submit_prompt",
                    content: [
                        `Skill: ${skill.name}`,
                        "",
                        `<skill_definition path="${skill.filePath}">`,
                        skillContent,
                        "</skill_definition>",
                        "",
                        `Task: ${task}`,
                    ].join("\n"),
                }
            },
        }))

        return this.cachedCommands
    }

    /** Reload commands when cwd changes */
    async reload(newCwd: string): Promise<SlashCommand[]> {
        this.cwd = newCwd
        return this.loadCommands()
    }

    getCached(): SlashCommand[] {
        return this.cachedCommands
    }
}
```

- [ ] **Step 3: Add `mergeCommands` to CommandRegistry**

In `src/commands/CommandRegistry.ts`, the `register` method is `private`. Add a public `mergeCommands`:

```typescript
// Add after the private register() method

/**
 * Merge external commands into the registry (skill commands, dynamic loaders).
 * Later registrations override earlier ones on name collision.
 */
mergeCommands(commands: SlashCommand[]): void {
    for (const cmd of commands) {
        this.commands.set(cmd.name, cmd)
        if (cmd.altNames) {
            for (const alt of cmd.altNames) {
                this.aliasMap.set(alt, cmd.name)
            }
        }
    }
}
```

- [ ] **Step 4: Wire into useSlashCommandProcessor**

In `src/tui/hooks/useSlashCommandProcessor.ts`, add skill loader with `useEffect` for initial load:

```typescript
// Add to imports
import { useEffect } from "react"
import { SkillCommandLoader } from "../../commands/loaders/SkillCommandLoader.js"

// In the hook body, after registry creation:
const skillLoader = useMemo(() => new SkillCommandLoader(config.cwd), [config.cwd])

// Load skill commands on mount and when cwd changes
useEffect(() => {
    skillLoader.loadCommands().then((skillCommands) => {
        registry.mergeCommands(skillCommands)
    }).catch(() => {
        // Skill loading is non-critical; log and continue
    })
}, [skillLoader, registry])
```

- [ ] **Step 4: Build and test**

Run: `npm run build`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/commands/loaders/SkillCommandLoader.ts src/commands/types.ts src/commands/CommandRegistry.ts src/tui/hooks/useSlashCommandProcessor.ts
git commit -m "feat: auto-register discovered skills as slash commands"
```

---

## Task 5: File Watcher Hot-Reload

**Why:** OpenClaw and Qwen-Code use file watchers (chokidar) to detect skill file changes and reload without restarting the session. This is critical for skill development workflow.

**Files:**
- Create: `src/server/skills/watcher.ts`
- Modify: `src/server/index.ts` — wire watcher lifecycle
- Modify: `src/server/agent.ts` — expose skill reload method
- Test: `src/server/skills/__tests__/watcher.test.ts`

- [ ] **Step 1: Install chokidar**

Run: `npm install chokidar`
**Note:** chokidar v4 ships its own types; `@types/chokidar` is not needed. If on v3, add `@types/chokidar`.
**Note:** chokidar v4 ships its own types; `@types/chokidar` is not needed. If the project uses chokidar v3, add `@types/chokidar` as well.

- [ ] **Step 2: Write the watcher**

```typescript
// src/server/skills/watcher.ts
import { watch, type FSWatcher } from "chokidar"
import { loadSkills } from "./loader.js"
import type { Skill, SkillLoadResult } from "./types.js"

export interface SkillWatcherCallbacks {
    /** Called when skills are reloaded */
    onReload: (result: SkillLoadResult) => void
    /** Called on watcher error */
    onError?: (error: Error) => void
}

export class SkillWatcher {
    private watcher?: FSWatcher
    private cwd: string
    private debounceTimer?: ReturnType<typeof setTimeout>
    private readonly debounceMs: number

    constructor(cwd: string, debounceMs = 150) {
        this.cwd = cwd
        this.debounceMs = debounceMs
    }

    async start(callbacks: SkillWatcherCallbacks): Promise<void> {
        // Load initial state to determine which directories to watch
        const initial = await loadSkills(this.cwd)

        // Collect unique parent directories to watch
        const dirsToWatch = new Set<string>()
        for (const skill of initial.skills) {
            // Watch the parent skills/ directory, not individual SKILL.md files
            const parentDir = skill.baseDir.split("/").slice(0, -1).join("/")
            dirsToWatch.add(parentDir)
        }

        if (dirsToWatch.size === 0) return

        this.watcher = watch(Array.from(dirsToWatch), {
            ignoreInitial: true,
            ignored: /(^|[/\\])\../, // ignore dotfiles
            persistent: true,
            depth: 3,
        })

        const debouncedReload = () => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(async () => {
                try {
                    const result = await loadSkills(this.cwd)
                    callbacks.onReload(result)
                } catch (err) {
                    callbacks.onError?.(err instanceof Error ? err : new Error(String(err)))
                }
            }, this.debounceMs)
        }

        this.watcher.on("add", debouncedReload)
        this.watcher.on("change", debouncedReload)
        this.watcher.on("unlink", debouncedReload)
        this.watcher.on("unlinkDir", debouncedReload)
        this.watcher.on("addDir", debouncedReload)
    }

    async stop(): Promise<void> {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        await this.watcher?.close()
        this.watcher = undefined
    }
}
```

- [ ] **Step 3: Write the test**

```typescript
// src/server/skills/__tests__/watcher.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { SkillWatcher } from "../watcher.js"

describe("SkillWatcher", () => {
    it("should call onReload when created and started", async () => {
        const onReload = vi.fn()
        const watcher = new SkillWatcher("/tmp/empty-dir", 50)
        // In an empty dir, no dirs to watch → start completes without error
        await watcher.start({ onReload })
        await watcher.stop()
        // onReload is NOT called at start — only on file changes
        expect(onReload).not.toHaveBeenCalled()
    })

    it("should stop cleanly", async () => {
        const watcher = new SkillWatcher("/tmp/empty-dir", 50)
        await watcher.start({ onReload: vi.fn() })
        await watcher.stop()
        // No error thrown
    })
})
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/server/skills/__tests__/watcher.test.ts`
Expected: PASS

- [ ] **Step 5: Wire watcher into server lifecycle**

In `src/server/index.ts`, in the `initialize` handler, after creating the agent. **Note:** The watcher only monitors directories of initially discovered skills. New skill directories created after startup require a session restart. Skills reloaded mid-session take effect on the next `agent.run()` call (system prompt is rebuilt each turn).

Also add cleanup on server process exit to prevent leaked file watchers:

```typescript
// After agent creation in the "initialize" handler:
import { SkillWatcher } from "./skills/watcher.js"

let skillWatcher: SkillWatcher | undefined

// ... inside initialize handler, after agent creation:
skillWatcher = new SkillWatcher(currentCwd)
skillWatcher.start({
    onReload: async (result) => {
        for (const d of result.diagnostics) debugLog("skills", d)
        if (agent) {
            agent.updateSkills(result.skills)
        }
    },
    onError: (err) => debugLog("skills", "Watcher error:", err.message),
})

// Cleanup on process exit (add at top-level of server module, outside handlers):
function cleanup() {
    skillWatcher?.stop().catch(() => {})
}
process.on("SIGTERM", cleanup)
process.on("SIGINT", cleanup)
process.on("exit", cleanup)
```

Add `updateSkills` to Agent class:

```typescript
// In src/server/agent.ts
updateSkills(skills: Skill[]): void {
    this.skills = skills
    // Re-register skill tool with updated skills
    const existingTool = this.tools.get("skill")
    if (existingTool) {
        this.tools.register(createSkillTool(skills))
    }
}
```

- [ ] **Step 6: Build and test**

Run: `npm run build && npx vitest run`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
git add src/server/skills/watcher.ts src/server/skills/__tests__/watcher.test.ts src/server/index.ts src/server/agent.ts package.json package-lock.json
git commit -m "feat: add file watcher for skill hot-reload"
```

---

## Task 6: Integration Testing

**Why:** Verify all components work together end-to-end before the final commit.

**Files:**
- Create: `src/server/skills/__tests__/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/server/skills/__tests__/integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { loadSkills } from "../loader.js"
import { createSkillTool } from "../../tools/skill.js"
import { buildSkillsPromptSection } from "../loader.js"

describe("skills system integration", () => {
    let tmpRoot: string
    let homeDir: string
    let projectDir: string
    let oldHome: string | undefined

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lop-int-"))
        homeDir = path.join(tmpRoot, "home")
        projectDir = path.join(tmpRoot, "project")
        await fs.mkdir(homeDir, { recursive: true })
        await fs.mkdir(projectDir, { recursive: true })
        await fs.mkdir(path.join(projectDir, ".git"), { recursive: true })
        oldHome = process.env.HOME
        process.env.HOME = homeDir
    })

    afterEach(async () => {
        if (oldHome === undefined) delete process.env.HOME
        else process.env.HOME = oldHome
        delete process.env.LOP_SKILLS_PATHS
        await fs.rm(tmpRoot, { recursive: true, force: true })
    })

    it("full flow: discover from .lop + .agents, create tool, build prompt", async () => {
        // Create skill in .lop/skills
        const lopSkill = path.join(projectDir, ".lop", "skills", "review")
        await fs.mkdir(lopSkill, { recursive: true })
        await fs.writeFile(
            path.join(lopSkill, "SKILL.md"),
            "---\nname: review\ndescription: Code review skill\n---\nReview instructions here.",
            "utf8",
        )

        // Create skill in .agents/skills
        const agentsSkill = path.join(projectDir, ".agents", "skills", "deploy")
        await fs.mkdir(agentsSkill, { recursive: true })
        await fs.writeFile(
            path.join(agentsSkill, "SKILL.md"),
            "---\nname: deploy\ndescription: Deploy skill\n---\nDeploy instructions.",
            "utf8",
        )

        // Step 1: loadSkills discovers both
        const { skills } = await loadSkills(projectDir)
        expect(skills.length).toBeGreaterThanOrEqual(2)
        expect(skills.map((s) => s.name)).toContain("review")
        expect(skills.map((s) => s.name)).toContain("deploy")

        // Step 2: createSkillTool works
        const tool = createSkillTool(skills)
        expect(tool.name).toBe("skill")
        expect(tool.description).toContain("review")
        expect(tool.description).toContain("deploy")

        // Step 3: buildSkillsPromptSection produces valid XML
        const prompt = buildSkillsPromptSection(skills)
        expect(prompt).toContain("<available_skills>")
        expect(prompt).toContain("<name>review</name>")
        expect(prompt).toContain("<name>deploy</name>")

        // Step 4: budget management works
        const compact = buildSkillsPromptSection(skills, { maxChars: 100 })
        expect(compact).toBeDefined()
        // Should still have skills but possibly truncated or compact
        expect(compact).toContain("<available_skills>")
    })

    it("skill tool invoke loads SKILL.md content", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "test-skill")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-skill\ndescription: Test\n---\nActual instructions.",
            "utf8",
        )

        const { skills } = await loadSkills(projectDir)
        const tool = createSkillTool(skills)
        const result = await tool.execute({ name: "test-skill" }, { cwd: projectDir })
        expect(result).toContain("<skill_content")
        expect(result).toContain("Actual instructions.")
    })
})
```

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 3: Final commit**

```bash
git add src/server/skills/__tests__/integration.test.ts
git commit -m "test: add integration tests for skills system optimization"
```

---

## Summary

| Task | What | Estimated Complexity |
|------|------|---------------------|
| 1 | Skill tool for LLM | Medium (new tool + registry wiring) |
| 2 | `.agents/skills/` compatibility | Low (add 2 paths + test) |
| 3 | Token budget management | Medium (extract + budget logic + tests) |
| 4 | Auto-register skill commands | Medium (new loader + CommandRegistry.mergeCommands + useEffect) |
| 5 | File watcher hot-reload | Medium (chokidar + server lifecycle) |
| 6 | Integration testing | Low (end-to-end verification) |

**Execution order:** Tasks 1→2→3→4→5→6 (each builds on the previous).
**Dependencies:**
- Task 1 (skill tool) is prerequisite for Task 3 (prompt says "use skill tool"), Task 5 (watcher re-registers tool), Task 6 (tool invoke test)
- Task 4 (auto-commands) is independent of Tasks 1-3 but should run after Task 1 for consistent ordering
- Task 5 (watcher) requires Task 1 for `updateSkills` + `createSkillTool`
- Task 6 (integration) requires all previous tasks

# Smart Init Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `lop init --smart` that scans the current project and auto-generates a populated `LOP.md` instead of an empty template.

**Architecture:** Pre-TUI CLI handler in `src/index.ts` reads `--smart` flag, collects relevant project files into a context message, makes a single one-shot `LLMClient.complete()` call with a LOP.md generation prompt, and writes the result. No server/TUI startup required — uses the same `loadConfig()` + `LLMClient` path already used by the server.

**Tech Stack:** TypeScript, `LLMClient.complete()` (already exists in `src/llm.ts:117`), `loadConfig()` (`src/config.ts`), Node.js `fs/promises`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/commands/init/lopMdPrompt.ts` | **Create** | System prompt for LOP.md generation |
| `src/commands/init/smartInit.ts` | **Create** | Project scanner + one-shot LLM call + file writer |
| `src/commands/init/smartInit.test.ts` | **Create** | Unit tests for scanner and context assembly |
| `src/index.ts` | **Modify** | Add `--smart` flag to existing `init` handler |

---

## Task 1: LOP.md generation prompt

**Files:** Create `src/commands/init/lopMdPrompt.ts`

- [ ] **Step 1: Create the prompt file**

```typescript
// src/commands/init/lopMdPrompt.ts

export const LOP_MD_GENERATION_PROMPT = `You are analyzing a software project to create a LOP.md file.
LOP.md is loaded automatically by the lop AI coding agent to understand this project.

Write a LOP.md that contains ONLY what a developer agent needs that cannot be discovered by reading the code.

## What to include

### Build & Dev Commands
Common commands: how to build, run tests, lint, start dev server, run a single test file.
Use the exact commands from package.json scripts, Makefile, or equivalent.

### Architecture
2-4 sentences on the high-level structure — what the major components are and how they relate.
Only include things that require reading multiple files to understand. Skip what is obvious from filenames.

### Conventions & Rules
Project-specific conventions: naming patterns, file organization rules, coding style decisions
that are not enforced by a linter. Only include what is genuinely non-obvious.

## What NOT to include
- Generic advice ("write tests", "handle errors", "never commit secrets")
- File listings or directory structure (the agent can see the files)
- Information that is already in README.md verbatim
- Obvious things like "this is a TypeScript project"

## Format
Start the file with:
\`\`\`
# Project Instructions
\`\`\`
Use ## headings. Be concise — under 400 words total.
Do not mention this generation process anywhere in the output.`
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/init/lopMdPrompt.ts
git commit -m "feat: add LOP.md generation prompt for smart init"
```

---

## Task 2: Project scanner and smart init function

**Files:** Create `src/commands/init/smartInit.ts` and `src/commands/init/smartInit.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/commands/init/smartInit.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtemp, writeFile, mkdir } from "fs/promises"
import { join } from "path"
import { tmpdir } from "os"
import { collectProjectContext } from "./smartInit.js"

describe("collectProjectContext", () => {
    let dir: string

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "lop-test-"))
    })

    it("includes README.md content when present", async () => {
        await writeFile(join(dir, "README.md"), "# MyProject\nA cool project.")
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("README.md")
        expect(ctx).toContain("A cool project.")
    })

    it("includes package.json scripts when present", async () => {
        await writeFile(join(dir, "package.json"), JSON.stringify({
            name: "my-app",
            scripts: { build: "tsc", test: "vitest run" },
        }, null, 2))
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("package.json")
        expect(ctx).toContain("vitest run")
    })

    it("includes top-level directory listing", async () => {
        await mkdir(join(dir, "src"))
        await writeFile(join(dir, "src", "index.ts"), "")
        const ctx = await collectProjectContext(dir)
        expect(ctx).toContain("src")
    })

    it("caps total context at MAX_CONTEXT_CHARS", async () => {
        // Write a very large README
        await writeFile(join(dir, "README.md"), "x".repeat(200_000))
        const ctx = await collectProjectContext(dir)
        expect(ctx.length).toBeLessThanOrEqual(60_000)
    })

    it("returns empty string when directory has no relevant files", async () => {
        const ctx = await collectProjectContext(dir)
        expect(typeof ctx).toBe("string")
    })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/commands/init/smartInit.test.ts 2>&1 | tail -10
```

Expected: FAIL — `collectProjectContext` not found

- [ ] **Step 3: Implement `collectProjectContext` and `runSmartInit`**

```typescript
// src/commands/init/smartInit.ts
import { readFile, readdir, stat } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import type { CoreMessage } from "ai"
import { LLMClient, type LLMConfig } from "../../llm.js"
import { LOP_MD_GENERATION_PROMPT } from "./lopMdPrompt.js"

const MAX_CONTEXT_CHARS = 50_000
const MAX_FILE_CHARS    = 15_000

/** Files to read in priority order. Stops once MAX_CONTEXT_CHARS is reached. */
const CANDIDATE_FILES = [
    "README.md",
    "package.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Makefile",
    "CLAUDE.md",
    ".cursorrules",
    ".github/copilot-instructions.md",
]

/** Read a file and cap it at MAX_FILE_CHARS (mid-truncation marker). */
async function readCapped(filePath: string): Promise<string> {
    const raw = await readFile(filePath, "utf-8")
    if (raw.length <= MAX_FILE_CHARS) return raw
    const half = Math.floor(MAX_FILE_CHARS / 2)
    return raw.slice(0, half) + `\n... [truncated] ...\n` + raw.slice(raw.length - half)
}

/** Collect project files into a single context string for the LLM. */
export async function collectProjectContext(cwd: string): Promise<string> {
    const parts: string[] = []
    let totalChars = 0

    // Top-level directory listing
    try {
        const entries = await readdir(cwd)
        const listing = entries.join("  ")
        parts.push(`## Directory listing (top-level)\n${listing}`)
        totalChars += listing.length
    } catch { /* ignore */ }

    // Priority files
    for (const rel of CANDIDATE_FILES) {
        if (totalChars >= MAX_CONTEXT_CHARS) break
        const fullPath = join(cwd, rel)
        if (!existsSync(fullPath)) continue
        try {
            const content = await readCapped(fullPath)
            parts.push(`## ${rel}\n${content}`)
            totalChars += content.length
        } catch { /* ignore */ }
    }

    return parts.join("\n\n")
}

/** Run smart init: scan project, call LLM, return generated LOP.md content. */
export async function runSmartInit(cwd: string, llmConfig: LLMConfig): Promise<string> {
    const context = await collectProjectContext(cwd)
    const llm = new LLMClient(llmConfig)

    const messages: CoreMessage[] = [
        {
            role: "user",
            content: context
                ? `Here is information about the project:\n\n${context}\n\nGenerate LOP.md for this project.`
                : "Generate a minimal LOP.md for an empty project.",
        },
    ]

    const result = await llm.complete(LOP_MD_GENERATION_PROMPT, messages)
    return result?.trim() ?? ""
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/commands/init/smartInit.test.ts 2>&1 | tail -10
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands/init/smartInit.ts src/commands/init/smartInit.test.ts
git commit -m "feat: add smart init project scanner and LLM generator"
```

---

## Task 3: Wire `--smart` flag into `src/index.ts`

**Files:** Modify `src/index.ts`

The current `init` block is at lines 15–38. Extend it to handle `--smart`.

- [ ] **Step 1: Add `--smart` branch to the init handler**

In `src/index.ts`, replace the `init` block:

```typescript
if (process.argv[2] === 'init') {
    const targetPath = path.resolve(process.cwd(), 'LOP.md')
    const smart = process.argv.includes('--smart')

    if (!smart) {
        // Existing template behaviour
        if (fs.existsSync(targetPath)) {
            console.log('LOP.md already exists. No changes made.')
            process.exit(0)
        }
        const template = `# Project Instructions\n\n<!-- Add project-specific instructions for the AI agent here. -->\n<!-- This file is loaded automatically from any directory in the project tree. -->\n\n## Code Style\n<!-- e.g. "Always use TypeScript strict mode." -->\n\n## Architecture\n<!-- e.g. "This is a Next.js App Router project." -->\n\n## Rules\n<!-- e.g. "Never commit secrets. Always write tests." -->\n`
        fs.writeFileSync(targetPath, template, 'utf8')
        console.log(`Created LOP.md at ${targetPath}`)
        process.exit(0)
    }

    // --smart: scan project and generate via LLM
    if (fs.existsSync(targetPath)) {
        console.log('LOP.md already exists. Remove it first or edit it manually.')
        process.exit(1)
    }

    const { runSmartInit } = await import('./commands/init/smartInit.js')
    const fileConfig = loadConfig()

    if (!fileConfig.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
        console.error('Error: No API key configured. Run `lop` to set up config first.')
        process.exit(1)
    }

    const llmConfig = {
        provider: fileConfig.provider ?? 'anthropic',
        model: fileConfig.model ?? 'claude-sonnet-4-6',
        apiKey: fileConfig.apiKey,
        baseURL: fileConfig.baseURL,
    }

    console.log('Scanning project and generating LOP.md...')
    try {
        const content = await runSmartInit(process.cwd(), llmConfig as any)
        if (!content) {
            console.error('Error: LLM returned empty content.')
            process.exit(1)
        }
        fs.writeFileSync(targetPath, content + '\n', 'utf8')
        console.log(`Created LOP.md at ${targetPath}`)
    } catch (err: any) {
        console.error(`Error: ${err?.message ?? String(err)}`)
        process.exit(1)
    }
    process.exit(0)
}
```

- [ ] **Step 2: Build and verify**

```bash
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -v chokidar
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire --smart flag into lop init command"
```

---

## Task 4: Final verification

- [ ] **Step 1: Run all tests**

```bash
npx vitest run src/commands/init/ 2>&1 | tail -15
```

Expected: All tests pass

- [ ] **Step 2: Full build**

```bash
npm run build 2>&1 | grep -v chokidar | grep -i error
```

Expected: no errors (chokidar warning is pre-existing, ignore)

- [ ] **Step 3: Smoke test — template mode still works**

```bash
cd /tmp && mkdir lop-test-template && cd lop-test-template
node /home/ubuntu/code/codeagent_minimal/dist/index.js init
cat LOP.md
```

Expected: LOP.md with empty template sections

- [ ] **Step 4: Smoke test — smart mode (requires API key)**

```bash
cd /tmp/lop-test-template && rm LOP.md
node /home/ubuntu/code/codeagent_minimal/dist/index.js init --smart
cat LOP.md
```

Expected: LOP.md with actual content (Build Commands, Architecture sections populated)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: verify smart init working end-to-end"
```

---

## Implementation Notes

**No API key guard:** The check before calling LLM only covers the most obvious missing-key scenario. The LLM call itself will throw with a clear provider error if the key is wrong — no extra handling needed.

**`llmConfig as any` cast:** `LLMConfig` requires `provider: Provider` (enum), but `fileConfig.provider` is typed as `Provider | undefined`. The fallback `'anthropic'` is a valid Provider value; the cast avoids a type-narrowing loop without adding a runtime check for something the LLM call will validate anyway.

**No streaming:** `llm.complete()` is a one-shot call — appropriate here since we want the full document before writing the file.

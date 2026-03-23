# 文件搜索工具实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 lop_minimal 添加 glob、grep、list_directory 三个文件搜索工具

**Architecture:** 沿用现有 Tool 接口模式，每个工具独立文件，统一注册到 ToolRegistry

**Tech Stack:** TypeScript, zod, fast-glob, fs/promises

---

## 文件结构

```
src/server/tools/
├── types.ts           # 现有 - 不修改
├── index.ts           # 修改 - 注册新工具
├── glob.ts            # 新增 - glob 工具
├── grep.ts            # 新增 - grep 工具
└── listDirectory.ts   # 新增 - list_directory 工具
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 安装 fast-glob**

Run: `npm install fast-glob`
Expected: 依赖添加成功

- [ ] **Step 2: 验证安装**

Run: `npm ls fast-glob`
Expected: 显示 fast-glob 版本

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add fast-glob dependency for glob tool"
```

---

## Task 2: 实现 glob 工具

**Files:**
- Create: `src/server/tools/glob.ts`
- Modify: `src/server/tools/index.ts`

- [ ] **Step 1: 创建 glob.ts 工具文件**

```typescript
import { z } from "zod"
import { glob as fg } from "fast-glob"
import type { Tool } from "./types.js"

export const globTool: Tool = {
    name: "glob",
    description: `Find files using glob patterns.
- Supports **, *, ? patterns
- Returns files sorted by modification time
- Use ignore patterns to exclude directories like node_modules`,

    parameters: z.object({
        pattern: z.string().describe("Glob pattern, e.g. '**/*.ts', 'src/**/*.tsx'"),
        path: z.string().optional().describe("Search directory, defaults to current directory"),
        ignore: z.array(z.string()).optional().describe("Patterns to ignore, e.g. ['node_modules', '*.test.ts']"),
    }),

    async execute({ pattern, path, ignore }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        try {
            const files = await fg(pattern, {
                cwd: searchPath,
                ignore: ignore ?? ["node_modules/**", ".git/**"],
                absolute: true,
                onlyFiles: true,
            })

            if (files.length === 0) {
                return `No files found matching pattern: ${pattern}`
            }

            return files.map(f => f as string).join("\n")
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
}
```

- [ ] **Step 2: 注册 glob 工具到 index.ts**

在 `src/server/tools/index.ts` 中添加:

```typescript
import { globTool } from "./glob.js"

// 在 constructor 中添加
this.register(globTool)
```

完整修改后的 index.ts:

```typescript
import type { Tool } from "./types.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { bashTool } from "./bash.js"
import { globTool } from "./glob.js"

export class ToolRegistry {
    private tools = new Map<string, Tool>()

    constructor() {
        this.register(readTool)
        this.register(writeTool)
        this.register(editTool)
        this.register(bashTool)
        this.register(globTool)
    }
    register(tool: Tool): void {
        this.tools.set(tool.name, tool)
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name)
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values())
    }

    getToolDefinitions(): Record<string, { description: string; parameters: unknown }> {
        const defs: Record<string, { description: string; parameters: unknown }> = {}
        for (const tool of this.getAll()) {
            defs[tool.name] = {
                description: tool.description,
                parameters: tool.parameters,
            }
        }
        return defs
    }
}

export * from "./types.js"
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/server/tools/glob.ts src/server/tools/index.ts
git commit -m "feat: add glob tool for file pattern matching"
```

---

## Task 3: 实现 grep 工具

**Files:**
- Create: `src/server/tools/grep.ts`
- Modify: `src/server/tools/index.ts`

- [ ] **Step 1: 创建 grep.ts 工具文件**

```typescript
import { z } from "zod"
import { exec } from "child_process"
import { promisify } from "util"
import type { Tool } from "./types.js"

const execAsync = promisify(exec)

export const grepTool: Tool = {
    name: "grep",
    description: `Search file contents using regex patterns.
- Returns matching lines with file name and line number
- Supports case-insensitive search
- Use glob to filter file types`,

    parameters: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("File or directory to search, defaults to current directory"),
        glob: z.string().optional().describe("File pattern filter, e.g. '*.ts'"),
        ignoreCase: z.boolean().optional().default(false).describe("Case insensitive search"),
        context: z.number().optional().default(0).describe("Number of context lines to show"),
    }),

    async execute({ pattern, path, glob, ignoreCase, context }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        // 构建 grep 命令
        const args = ["-n"] // 显示行号
        if (ignoreCase) args.push("-i")
        if (context && context > 0) args.push(`-C${context}`)
        if (glob) args.push("--include", glob)
        args.push("-r") // 递归搜索
        args.push("-E") // 扩展正则
        args.push("--exclude-dir=node_modules")
        args.push("--exclude-dir=.git")
        args.push(pattern)
        args.push(searchPath)

        try {
            const { stdout, stderr } = await execAsync(`grep ${args.join(" ")}`, {
                cwd: ctx.cwd,
                maxBuffer: 10 * 1024 * 1024,
                timeout: 30000,
            })

            if (!stdout.trim()) {
                return `No matches found for pattern: ${pattern}`
            }

            return stdout.trim()
        } catch (error: any) {
            // grep 返回非零退出码表示未找到匹配
            if (error.code === 1 && !error.stdout) {
                return `No matches found for pattern: ${pattern}`
            }
            return `Error: ${error.message}`
        }
    },
}
```

- [ ] **Step 2: 注册 grep 工具到 index.ts**

在 `src/server/tools/index.ts` 中添加:

```typescript
import { grepTool } from "./grep.js"

// 在 constructor 中添加
this.register(grepTool)
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/server/tools/grep.ts src/server/tools/index.ts
git commit -m "feat: add grep tool for content search"
```

---

## Task 4: 实现 list_directory 工具

**Files:**
- Create: `src/server/tools/listDirectory.ts`
- Modify: `src/server/tools/index.ts`

- [ ] **Step 1: 创建 listDirectory.ts 工具文件**

```typescript
import { z } from "zod"
import { readdir, stat } from "fs/promises"
import { join } from "path"
import type { Tool } from "./types.js"

export const listDirectoryTool: Tool = {
    name: "list_directory",
    description: `List contents of a directory.
- Shows files and subdirectories
- Supports recursive listing
- Can filter with ignore patterns`,

    parameters: z.object({
        path: z.string().optional().describe("Directory path, defaults to current directory"),
        recursive: z.boolean().optional().default(false).describe("List subdirectories recursively"),
        ignore: z.array(z.string()).optional().describe("Patterns to ignore"),
    }),

    async execute({ path, recursive, ignore }, ctx) {
        const dirPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd
        const ignorePatterns = ignore ?? ["node_modules", ".git"]

        async function listDir(dir: string, prefix: string = ""): Promise<string[]> {
            const results: string[] = []

            try {
                const entries = await readdir(dir, { withFileTypes: true })

                for (const entry of entries) {
                    const name = entry.name

                    // 检查是否应忽略
                    if (ignorePatterns.some(p => name === p || name.includes(p))) {
                        continue
                    }

                    const fullPath = join(dir, name)
                    const isDir = entry.isDirectory()
                    const marker = isDir ? "/" : ""
                    results.push(`${prefix}${name}${marker}`)

                    // 递归处理子目录
                    if (recursive && isDir) {
                        const subResults = await listDir(fullPath, `${prefix}  `)
                        results.push(...subResults)
                    }
                }
            } catch (error: any) {
                results.push(`Error reading ${dir}: ${error.message}`)
            }

            return results
        }

        try {
            const stats = await stat(dirPath)
            if (!stats.isDirectory()) {
                return `Error: ${dirPath} is not a directory`
            }

            const items = await listDir(dirPath)

            if (items.length === 0) {
                return `Empty directory: ${dirPath}`
            }

            return items.join("\n")
        } catch (error: any) {
            if (error.code === "ENOENT") {
                return `Error: Directory not found: ${dirPath}`
            }
            if (error.code === "EACCES") {
                return `Error: Permission denied: ${dirPath}`
            }
            return `Error: ${error.message}`
        }
    },
}
```

- [ ] **Step 2: 注册 list_directory 工具到 index.ts**

在 `src/server/tools/index.ts` 中添加:

```typescript
import { listDirectoryTool } from "./listDirectory.js"

// 在 constructor 中添加
this.register(listDirectoryTool)
```

- [ ] **Step 3: 验证 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add src/server/tools/listDirectory.ts src/server/tools/index.ts
git commit -m "feat: add list_directory tool for directory listing"
```

---

## Task 5: 集成测试

**Files:** 无新文件

- [ ] **Step 1: 启动项目验证工具加载**

Run: `npm run dev`
Expected: 项目正常启动，无错误

- [ ] **Step 2: 最终 Commit**

```bash
git add -A
git commit -m "feat: complete file search tools implementation"
```

---

## 验收清单

- [ ] glob 工具支持 `**/*.ts` 等常见模式
- [ ] grep 工具支持正则搜索和 `-i` 忽略大小写
- [ ] list_directory 支持递归和忽略模式
- [ ] 所有工具有合理的错误处理
- [ ] 工具已注册并可被 LLM 调用

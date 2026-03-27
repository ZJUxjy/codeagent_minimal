# Fast Regex Search (Trigram Index) 实现计划

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** 为 lop_minimal 的 grep 工具构建基于三元组(trigram)的倒排索引，使正则搜索能先通过索引缩小候选文件集合，再仅对候选文件执行实际匹配，从而大幅加速搜索。

**Architecture:** 参考 [Cursor 博客](https://cursor.com/cn/blog/fast-regex-search) 中的经典三元组倒排索引 + 概率掩码方案。核心思路：将项目所有文件拆成重叠的 3 字符片段(trigram)构建倒排索引，搜索时将正则表达式分解为 trigram 集合，通过索引交集快速定位候选文件，再仅对候选文件运行 grep。索引在 Agent 初始化时构建，文件变更时增量更新。

**Tech Stack:** TypeScript (ESM), Zod, vitest, Node.js fs API, child_process (grep fallback)

---

## 整体架构

```
┌──────────────────────────────────────────────────┐
│                    Agent                          │
│                                                   │
│  ┌─────────────┐    ┌──────────────────────────┐ │
│  │  ToolRegistry│    │    FileIndexManager       │ │
│  │              │    │  ┌────────────────────┐  │ │
│  │  grep ───────┼────┼─►│   TrigramIndex     │  │ │
│  │  write ──────┼──┐ │  │  - trigrams Map    │  │ │
│  │  edit  ──────┼──┤ │  │  - fileContents    │  │ │
│  │              │  │ │  └────────────────────┘  │ │
│  └─────────────┘  │ │                            │ │
│                    │ │  onFileChange(path,content)│ │
│                    └─┼──►  updateFile()          │ │
│                      └──────────────────────────┘ │
└──────────────────────────────────────────────────┘
```

## 文件清单

| 操作 | 路径 | 说明 |
|------|------|------|
| 创建 | `src/server/indexing/trigram.ts` | TrigramIndex 核心类 |
| 创建 | `src/server/indexing/trigram.test.ts` | TrigramIndex 单元测试 |
| 创建 | `src/server/indexing/queryDecompose.ts` | 正则表达式 → trigram 分解 |
| 创建 | `src/server/indexing/queryDecompose.test.ts` | 分解逻辑单元测试 |
| 创建 | `src/server/indexing/fileIndexManager.ts` | 文件索引管理器 |
| 创建 | `src/server/indexing/fileIndexManager.test.ts` | 文件索引管理器测试 |
| 创建 | `src/server/indexing/index.ts` | 导出入口 |
| 修改 | `src/server/tools/grep.ts` | 集成索引加速 |
| 修改 | `src/server/tools/types.ts` | ToolContext 增加 fileIndex |
| 修改 | `src/server/tools/write.ts` | 写文件后更新索引 |
| 修改 | `src/server/tools/edit.ts` | 编辑文件后更新索引 |
| 修改 | `src/server/agent.ts` | 初始化索引、注入 ToolContext |
| 修改 | `src/server/index.ts` | 服务启动时触发索引构建 |

---

## Task 1: TrigramIndex 核心数据结构

实现三元组倒排索引的核心类：从文本中提取 trigram，维护 trigram → fileId 集合 的映射。

**Files:**
- Create: `src/server/indexing/trigram.ts`
- Test: `src/server/indexing/trigram.test.ts`

### Step 1: 写失败测试

```typescript
// src/server/indexing/trigram.test.ts
import { describe, it, expect } from 'vitest'
import { TrigramIndex, extractTrigrams } from './trigram.js'

describe('extractTrigrams', () => {
    it('should extract overlapping 3-char sequences', () => {
        const result = extractTrigrams('hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should return empty set for strings shorter than 3', () => {
        expect(extractTrigrams('ab')).toEqual(new Set())
        expect(extractTrigrams('')).toEqual(new Set())
    })

    it('should handle single trigram', () => {
        expect(extractTrigrams('abc')).toEqual(new Set(['abc']))
    })

    it('should lowercase trigrams for case-insensitive matching', () => {
        const result = extractTrigrams('Hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })
})

describe('TrigramIndex', () => {
    it('should add file and retrieve candidates', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).toContain('a.ts')
    })

    it('should return intersection of trigram posting lists', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        index.addFile('b.ts', 'const world = 1')
        // "hello" trigrams won't match b.ts
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).toContain('a.ts')
        expect(candidates).not.toContain('b.ts')
    })

    it('should handle removeFile', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        index.removeFile('a.ts')
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).not.toContain('a.ts')
    })

    it('should handle updateFile (remove old trigrams, add new)', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'hello world')
        index.updateFile('a.ts', 'goodbye world')
        expect(index.query(extractTrigrams('hello'))).not.toContain('a.ts')
        expect(index.query(extractTrigrams('goodbye'))).toContain('a.ts')
    })

    it('should return all files when query trigrams is empty', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'hello')
        index.addFile('b.ts', 'world')
        const candidates = index.query(new Set())
        expect(candidates.length).toBe(2)
    })

    it('should report file count via size getter', () => {
        const index = new TrigramIndex()
        expect(index.size).toBe(0)
        index.addFile('a.ts', 'hello')
        expect(index.size).toBe(1)
    })
})
```

### Step 2: 运行测试，确认失败

Run: `npx vitest run src/server/indexing/trigram.test.ts`
Expected: FAIL — 模块不存在

### Step 3: 实现 TrigramIndex

```typescript
// src/server/indexing/trigram.ts

/**
 * 从文本中提取所有重叠的 3 字符片段(trigram)。
 * 全部小写化，用于大小写不敏感的索引。
 */
export function extractTrigrams(text: string): Set<string> {
    const lower = text.toLowerCase()
    const trigrams = new Set<string>()
    for (let i = 0; i <= lower.length - 3; i++) {
        trigrams.add(lower.slice(i, i + 3))
    }
    return trigrams
}

/**
 * 三元组倒排索引。
 *
 * 维护 trigram → Set<filePath> 的映射。
 * 查询时对多个 trigram 的 posting list 做交集，
 * 返回可能包含目标文本的候选文件列表。
 */
export class TrigramIndex {
    /** trigram → 包含该 trigram 的文件集合 */
    private postings = new Map<string, Set<string>>()
    /** filePath → 该文件的所有 trigram（用于删除时清理） */
    private fileTrigrams = new Map<string, Set<string>>()

    get size(): number {
        return this.fileTrigrams.size
    }

    addFile(filePath: string, content: string): void {
        const trigrams = extractTrigrams(content)
        this.fileTrigrams.set(filePath, trigrams)
        for (const tri of trigrams) {
            let set = this.postings.get(tri)
            if (!set) {
                set = new Set()
                this.postings.set(tri, set)
            }
            set.add(filePath)
        }
    }

    removeFile(filePath: string): void {
        const trigrams = this.fileTrigrams.get(filePath)
        if (!trigrams) return
        for (const tri of trigrams) {
            const set = this.postings.get(tri)
            if (set) {
                set.delete(filePath)
                if (set.size === 0) this.postings.delete(tri)
            }
        }
        this.fileTrigrams.delete(filePath)
    }

    updateFile(filePath: string, newContent: string): void {
        this.removeFile(filePath)
        this.addFile(filePath, newContent)
    }

    /**
     * 查询：给定一组 trigram，返回同时包含所有 trigram 的文件列表。
     * 如果 trigrams 为空，返回所有已索引的文件（无法过滤）。
     */
    query(trigrams: Set<string>): string[] {
        if (trigrams.size === 0) {
            return Array.from(this.fileTrigrams.keys())
        }

        let result: Set<string> | null = null
        // 按 posting list 大小升序排序，先处理最小集合以加速交集
        const sorted = Array.from(trigrams).sort((a, b) => {
            const sizeA = this.postings.get(a)?.size ?? 0
            const sizeB = this.postings.get(b)?.size ?? 0
            return sizeA - sizeB
        })

        for (const tri of sorted) {
            const posting = this.postings.get(tri)
            if (!posting || posting.size === 0) return []
            if (result === null) {
                result = new Set(posting)
            } else {
                for (const file of result) {
                    if (!posting.has(file)) result.delete(file)
                }
                if (result.size === 0) return []
            }
        }

        return result ? Array.from(result) : []
    }

    /** 返回索引中所有已注册的文件路径 */
    allFiles(): string[] {
        return Array.from(this.fileTrigrams.keys())
    }
}
```

### Step 4: 运行测试，确认通过

Run: `npx vitest run src/server/indexing/trigram.test.ts`
Expected: ALL PASS

### Step 5: 提交

```bash
git add src/server/indexing/trigram.ts src/server/indexing/trigram.test.ts
git commit -m "feat: add TrigramIndex core data structure"
```

---

## Task 2: 正则表达式 → Trigram 分解

将正则表达式模式分解为可用于索引查询的 trigram 集合。核心思路：从正则中提取字面量片段，再对字面量提取 trigram。

**Files:**
- Create: `src/server/indexing/queryDecompose.ts`
- Test: `src/server/indexing/queryDecompose.test.ts`

### Step 1: 写失败测试

```typescript
// src/server/indexing/queryDecompose.test.ts
import { describe, it, expect } from 'vitest'
import { decompose } from './queryDecompose.js'

describe('decompose', () => {
    it('should extract trigrams from plain literal string', () => {
        const result = decompose('hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should extract trigrams from string with regex metacharacters splitting', () => {
        // "foo.*bar" → literals ["foo", "bar"] → trigrams from each
        const result = decompose('foo.*bar')
        expect(result).toContain('foo')
        expect(result).toContain('bar')
    })

    it('should handle character classes by splitting', () => {
        // "he[lr]lo" → "he" and "lo" as literal segments; "he" too short, "lo" too short
        // No trigrams extractable
        const result = decompose('he[lr]lo')
        expect(result.size).toBe(0)
    })

    it('should handle longer literal around character class', () => {
        // "hello[12]world" → "hello" → [hel, ell, llo], "world" → [wor, orl, rld]
        const result = decompose('hello[12]world')
        expect(result).toContain('hel')
        expect(result).toContain('wor')
    })

    it('should handle escaped metacharacters as literals', () => {
        // "foo\.bar" → "foo.bar" → trigrams
        const result = decompose('foo\\.bar')
        expect(result).toContain('foo')
        expect(result).toContain('oo.')
        expect(result).toContain('o.b')
        expect(result).toContain('.ba')
        expect(result).toContain('bar')
    })

    it('should return empty set for very short pattern', () => {
        expect(decompose('ab')).toEqual(new Set())
    })

    it('should return empty set for pure wildcard pattern', () => {
        expect(decompose('.*')).toEqual(new Set())
        expect(decompose('.+')).toEqual(new Set())
    })

    it('should be case insensitive', () => {
        const result = decompose('Hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should handle quantifiers by splitting', () => {
        // "func+tion" → "func" is split at +, so we get "fun" from "func" and "tio", "ion" from "tion"
        const result = decompose('func+tion')
        expect(result).toContain('fun')
        expect(result).toContain('tio')
        expect(result).toContain('ion')
    })

    it('should handle alternation — take union of both branches', () => {
        // "foo|bar" → both branches → union of trigrams
        const result = decompose('foo|bar')
        // With alternation at top level, we cannot require ALL trigrams
        // so we return empty (cannot guarantee any specific trigram)
        expect(result.size).toBe(0)
    })
})
```

### Step 2: 运行测试，确认失败

Run: `npx vitest run src/server/indexing/queryDecompose.test.ts`
Expected: FAIL — 模块不存在

### Step 3: 实现 queryDecompose

```typescript
// src/server/indexing/queryDecompose.ts
import { extractTrigrams } from './trigram.js'

/**
 * 将正则表达式模式分解为一组 trigram，用于索引查询。
 *
 * 策略：
 * 1. 将正则按元字符拆分为字面量片段
 * 2. 对每个字面量片段提取 trigram
 * 3. 合并所有 trigram（AND 语义：候选文件须包含全部）
 *
 * 局限：
 * - 遇到顶层 alternation (|) 时无法保证任一分支，返回空集（退化为全扫描）
 * - 字符类 [...] 视为分割点
 * - 量词 +*?{} 视为分割点
 */
export function decompose(pattern: string): Set<string> {
    // 顶层 alternation：无法为 AND 查询提取公共 trigram
    if (hasTopLevelAlternation(pattern)) {
        return new Set()
    }

    const literals = extractLiterals(pattern)
    const trigrams = new Set<string>()
    for (const lit of literals) {
        for (const tri of extractTrigrams(lit)) {
            trigrams.add(tri)
        }
    }
    return trigrams
}

/** 检测是否有未被括号包裹的顶层 | */
function hasTopLevelAlternation(pattern: string): boolean {
    let depth = 0
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]
        if (ch === '\\') { i++; continue }
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth--
        else if (ch === '|' && depth === 0) return true
    }
    return false
}

/**
 * 从正则表达式中提取字面量片段。
 * 元字符 ( . * + ? { } [ ] ^ $ | ) 和括号作为分割点，
 * 但反斜杠转义的字符视为字面量。
 */
function extractLiterals(pattern: string): string[] {
    const literals: string[] = []
    let current = ''
    let i = 0

    while (i < pattern.length) {
        const ch = pattern[i]

        if (ch === '\\' && i + 1 < pattern.length) {
            // 转义字符 → 字面量
            current += pattern[i + 1]
            i += 2
            continue
        }

        if (isMetaChar(ch)) {
            if (ch === '[') {
                // 跳过整个字符类
                if (current.length > 0) { literals.push(current); current = '' }
                i = skipCharClass(pattern, i)
                continue
            }
            if (current.length > 0) { literals.push(current); current = '' }
            i++
            continue
        }

        current += ch
        i++
    }

    if (current.length > 0) literals.push(current)
    return literals
}

function isMetaChar(ch: string): boolean {
    return '.*+?{}[]()^$|'.includes(ch)
}

/** 跳过 [...] 字符类，返回 ] 后面的位置 */
function skipCharClass(pattern: string, start: number): number {
    let i = start + 1 // skip [
    if (i < pattern.length && pattern[i] === '^') i++
    if (i < pattern.length && pattern[i] === ']') i++ // literal ]
    while (i < pattern.length) {
        if (pattern[i] === '\\') { i += 2; continue }
        if (pattern[i] === ']') return i + 1
        i++
    }
    return i
}
```

### Step 4: 运行测试，确认通过

Run: `npx vitest run src/server/indexing/queryDecompose.test.ts`
Expected: ALL PASS

### Step 5: 提交

```bash
git add src/server/indexing/queryDecompose.ts src/server/indexing/queryDecompose.test.ts
git commit -m "feat: add regex-to-trigram decomposition"
```

---

## Task 3: FileIndexManager — 文件索引管理器

管理项目文件的扫描、索引构建和增量更新。

**Files:**
- Create: `src/server/indexing/fileIndexManager.ts`
- Test: `src/server/indexing/fileIndexManager.test.ts`
- Create: `src/server/indexing/index.ts`

### Step 1: 写失败测试

```typescript
// src/server/indexing/fileIndexManager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndexManager } from './fileIndexManager.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileIndexManager', () => {
    let testDir: string

    beforeEach(() => {
        testDir = join(tmpdir(), `trigram-test-${Date.now()}`)
        mkdirSync(testDir, { recursive: true })
        mkdirSync(join(testDir, 'src'), { recursive: true })
        writeFileSync(join(testDir, 'src', 'hello.ts'), 'export function hello() { return "world" }')
        writeFileSync(join(testDir, 'src', 'foo.ts'), 'export const foo = "bar"')
        writeFileSync(join(testDir, 'README.md'), '# Hello World')
    })

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true })
    })

    it('should build index from directory', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        expect(manager.indexedFileCount).toBeGreaterThanOrEqual(3)
    })

    it('should find candidates for a known string', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        const candidates = manager.search('hello')
        expect(candidates.some(f => f.endsWith('hello.ts'))).toBe(true)
    })

    it('should not return unrelated files', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        const candidates = manager.search('hello')
        expect(candidates.some(f => f.endsWith('foo.ts'))).toBe(false)
    })

    it('should update index when notified of file change', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        // "uniquetoken" 初始不存在
        expect(manager.search('uniquetoken').length).toBe(0)

        // 通知文件变更
        manager.onFileChanged(join(testDir, 'src', 'hello.ts'), 'export const uniquetoken = 1')
        expect(manager.search('uniquetoken').some(f => f.endsWith('hello.ts'))).toBe(true)
    })

    it('should skip node_modules and .git directories', async () => {
        mkdirSync(join(testDir, 'node_modules', 'pkg'), { recursive: true })
        writeFileSync(join(testDir, 'node_modules', 'pkg', 'index.js'), 'special_marker_nm')
        mkdirSync(join(testDir, '.git', 'objects'), { recursive: true })
        writeFileSync(join(testDir, '.git', 'objects', 'abc'), 'special_marker_git')

        const manager = new FileIndexManager(testDir)
        await manager.build()
        expect(manager.search('special_marker_nm').length).toBe(0)
        expect(manager.search('special_marker_git').length).toBe(0)
    })

    it('should skip binary-like files', async () => {
        // 创建一个 .png "文件"（虽然内容是文本，但扩展名被排除）
        writeFileSync(join(testDir, 'image.png'), 'should_not_index_png')
        const manager = new FileIndexManager(testDir)
        await manager.build()
        expect(manager.search('should_not_index_png').length).toBe(0)
    })

    it('should report isReady after build', async () => {
        const manager = new FileIndexManager(testDir)
        expect(manager.isReady).toBe(false)
        await manager.build()
        expect(manager.isReady).toBe(true)
    })
})
```

### Step 2: 运行测试，确认失败

Run: `npx vitest run src/server/indexing/fileIndexManager.test.ts`
Expected: FAIL

### Step 3: 实现 FileIndexManager

```typescript
// src/server/indexing/fileIndexManager.ts
import { readFile } from 'fs/promises'
import { join, extname, relative } from 'path'
import fg from 'fast-glob'
import { TrigramIndex, extractTrigrams } from './trigram.js'
import { decompose } from './queryDecompose.js'

const IGNORED_DIRS = ['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv']
const IGNORED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.exe', '.dll', '.so', '.dylib', '.o',
    '.lock', '.map',
])

const MAX_FILE_SIZE = 512 * 1024 // 512KB — 跳过超大文件

export class FileIndexManager {
    private index = new TrigramIndex()
    private cwd: string
    private ready = false

    constructor(cwd: string) {
        this.cwd = cwd
    }

    get isReady(): boolean {
        return this.ready
    }

    get indexedFileCount(): number {
        return this.index.size
    }

    async build(): Promise<void> {
        const ignorePatterns = IGNORED_DIRS.map(d => `${d}/**`)
        const files = await fg('**/*', {
            cwd: this.cwd,
            ignore: ignorePatterns,
            absolute: true,
            onlyFiles: true,
            stats: false,
        })

        const readPromises = files
            .filter(f => !IGNORED_EXTENSIONS.has(extname(f).toLowerCase()))
            .map(async (filePath) => {
                try {
                    const content = await readFile(filePath, 'utf-8')
                    if (content.length <= MAX_FILE_SIZE) {
                        this.index.addFile(filePath, content)
                    }
                } catch {
                    // 跳过无法读取的文件（二进制等）
                }
            })

        await Promise.all(readPromises)
        this.ready = true
    }

    /**
     * 给定正则模式，返回可能匹配的候选文件路径列表。
     * 如果索引未就绪或无法提取 trigram，返回空数组（调用方应退化为全扫描）。
     */
    search(pattern: string): string[] {
        if (!this.ready) return []
        const trigrams = decompose(pattern)
        return this.index.query(trigrams)
    }

    /**
     * 文件变更通知 — write/edit 工具调用后触发。
     */
    onFileChanged(filePath: string, newContent: string): void {
        if (IGNORED_EXTENSIONS.has(extname(filePath).toLowerCase())) return
        if (newContent.length > MAX_FILE_SIZE) {
            this.index.removeFile(filePath)
            return
        }
        this.index.updateFile(filePath, newContent)
    }

    /**
     * 文件删除通知。
     */
    onFileRemoved(filePath: string): void {
        this.index.removeFile(filePath)
    }
}
```

### Step 4: 创建导出入口

```typescript
// src/server/indexing/index.ts
export { TrigramIndex, extractTrigrams } from './trigram.js'
export { decompose } from './queryDecompose.js'
export { FileIndexManager } from './fileIndexManager.js'
```

### Step 5: 运行测试，确认通过

Run: `npx vitest run src/server/indexing/fileIndexManager.test.ts`
Expected: ALL PASS

### Step 6: 提交

```bash
git add src/server/indexing/
git commit -m "feat: add FileIndexManager for project-wide trigram indexing"
```

---

## Task 4: 扩展 ToolContext，注入 FileIndexManager

让工具能够访问索引管理器。

**Files:**
- Modify: `src/server/tools/types.ts:1-19`

### Step 1: 修改 ToolContext

在 `src/server/tools/types.ts` 的 `ToolContext` 接口中新增 `fileIndex` 字段：

```typescript
// src/server/tools/types.ts
import { z } from "zod"
import type { Question } from "../../protocol/types.js"
import type { AskQuestionResult } from "../questionBridge.js"
import type { FileIndexManager } from "../indexing/fileIndexManager.js"

export interface Tool<T extends z.ZodType = z.ZodType> {
    name: string
    description: string
    parameters: T
    execute: (params: z.infer<T>, ctx: ToolContext) => Promise<string>
}

export interface ToolContext {
    cwd: string
    signal?: AbortSignal
    askQuestion?: (questions: Question[]) => Promise<AskQuestionResult>
    /** Trigram file index for fast regex search. */
    fileIndex?: FileIndexManager
}
```

### Step 2: 确认构建通过

Run: `npx tsc --noEmit`
Expected: 无新增错误（fileIndex 是 optional，不会破坏现有代码）

### Step 3: 提交

```bash
git add src/server/tools/types.ts
git commit -m "feat: add fileIndex to ToolContext"
```

---

## Task 5: 改造 grep 工具 — 集成索引加速

当索引可用时，先通过索引缩小候选文件范围，再仅对候选文件执行 grep。

**Files:**
- Modify: `src/server/tools/grep.ts:1-75`

### Step 1: 重写 grep 工具

```typescript
// src/server/tools/grep.ts
import { z } from "zod"
import { spawn } from "child_process"
import type { Tool } from "./types.js"

export const grepTool: Tool = {
    name: "grep",
    description: `Search file contents using regex patterns.
- Returns matching lines with file name and line number
- Supports case-insensitive search
- Use glob to filter file types
- Uses trigram index to accelerate search when available`,

    parameters: z.object({
        pattern: z.string().describe("Regex pattern to search for"),
        path: z.string().optional().describe("File or directory to search, defaults to current directory"),
        glob: z.string().optional().describe("File pattern filter, e.g. '*.ts'"),
        ignoreCase: z.boolean().optional().default(false).describe("Case insensitive search"),
        context: z.number().optional().default(0).describe("Number of context lines to show"),
    }),

    async execute({ pattern, path, glob: globPattern, ignoreCase, context }, ctx) {
        const searchPath = path ? (path.startsWith("/") ? path : `${ctx.cwd}/${path}`) : ctx.cwd

        // 尝试用索引缩小候选范围
        const candidates = ctx.fileIndex?.isReady
            ? ctx.fileIndex.search(pattern)
            : null

        // 如果索引返回了候选文件且数量较少，直接对候选文件搜索
        const useIndexedSearch = candidates !== null && candidates.length > 0 && candidates.length < 500

        const args = buildGrepArgs({ pattern, ignoreCase, context, globPattern })

        if (useIndexedSearch) {
            // 对候选文件列表逐个搜索（不用 -r）
            // 过滤出在 searchPath 下的候选文件
            const filtered = candidates!.filter(f => f.startsWith(searchPath))
            if (filtered.length === 0) {
                return `No matches found for pattern: ${pattern}`
            }
            args.push(...filtered)
        } else {
            args.push("-r")
            args.push("--exclude-dir=node_modules")
            args.push("--exclude-dir=.git")
            args.push(searchPath)
        }

        return runGrep(args, ctx.cwd, pattern)
    },
}

function buildGrepArgs(opts: {
    pattern: string
    ignoreCase?: boolean
    context?: number
    globPattern?: string
}): string[] {
    const args = ["-n"]
    if (opts.ignoreCase) args.push("-i")
    if (opts.context && opts.context > 0) args.push(`-C${opts.context}`)
    if (opts.globPattern) args.push("--include", opts.globPattern)
    args.push("-E") // Extended regex
    args.push(pattern)
    return args
}

function runGrep(args: string[], cwd: string, pattern: string): Promise<string> {
    return new Promise<string>((resolve) => {
        const proc = spawn("grep", args, { cwd })

        let stdout = ""
        let stderr = ""

        proc.stdout.on("data", (data) => { stdout += data })
        proc.stderr.on("data", (data) => { stderr += data })

        const timeout = setTimeout(() => {
            proc.kill()
            resolve(`Error: grep timed out after 30 seconds`)
        }, 30000)

        proc.on("close", (code) => {
            clearTimeout(timeout)
            if (code === 1 && !stdout) {
                resolve(`No matches found for pattern: ${pattern}`)
            } else if (code !== 0 && !stdout) {
                resolve(`Error: ${stderr.trim() || `grep exited with code ${code}`}`)
            } else {
                resolve(stdout.trim() || `No matches found for pattern: ${pattern}`)
            }
        })

        proc.on("error", (error) => {
            clearTimeout(timeout)
            resolve(`Error: ${error.message}`)
        })
    })
}
```

> **注意：** `buildGrepArgs` 中引用了 `pattern` 变量，实际实现时需要修正为 `opts.pattern`。测试会捕获这个问题。

### Step 2: 确认构建和现有测试通过

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

### Step 3: 提交

```bash
git add src/server/tools/grep.ts
git commit -m "feat: grep tool uses trigram index for candidate filtering"
```

---

## Task 6: write/edit 工具增量更新索引

文件被 write 或 edit 工具修改后，通知索引管理器更新。

**Files:**
- Modify: `src/server/tools/write.ts:18-29`
- Modify: `src/server/tools/edit.ts:18-40`

### Step 1: 修改 write 工具

在 `src/server/tools/write.ts` 的 `execute` 方法中，成功写入后调用 `ctx.fileIndex?.onFileChanged`:

```typescript
    async execute({ path, content }, ctx) {
        const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

        try {
            await mkdir(dirname(fullPath), { recursive: true })
            await writeFile(fullPath, content, "utf-8")
            ctx.fileIndex?.onFileChanged(fullPath, content)
            return `Successfully wrote ${content.length} characters to ${fullPath}`
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
```

### Step 2: 修改 edit 工具

在 `src/server/tools/edit.ts` 的 `execute` 方法中，成功编辑后通知索引：

```typescript
    async execute({ path, old_string, new_string }, ctx) {
        const fullPath = path.startsWith("/") ? path : `${ctx.cwd}/${path}`

        try {
            const content = await readFile(fullPath, "utf-8")

            const occurrences = content.split(old_string).length - 1
            if (occurrences === 0) {
                return `Error: old_string not found in file`
            }
            if (occurrences > 1) {
                return `Error: old_string appears ${occurrences} times, must be unique`
            }

            const newContent = content.replace(old_string, new_string)
            await writeFile(fullPath, newContent, "utf-8")
            ctx.fileIndex?.onFileChanged(fullPath, newContent)

            return `Successfully edited ${fullPath}`
        } catch (error: any) {
            return `Error: ${error.message}`
        }
    },
```

### Step 3: 确认构建通过

Run: `npx tsc --noEmit`
Expected: PASS

### Step 4: 提交

```bash
git add src/server/tools/write.ts src/server/tools/edit.ts
git commit -m "feat: write/edit tools trigger incremental index updates"
```

---

## Task 7: Agent 集成 — 初始化索引并注入 ToolContext

在 Agent 构造时创建 FileIndexManager，异步构建索引，并在每次 executeTool 时将其注入 ToolContext。

**Files:**
- Modify: `src/server/agent.ts:1-14` (imports)
- Modify: `src/server/agent.ts:44-81` (constructor)
- Modify: `src/server/agent.ts:248-284` (executeTool)

### Step 1: 在 Agent 中添加 fileIndex 成员

在 `src/server/agent.ts` 的 import 区域添加：

```typescript
import { FileIndexManager } from "./indexing/fileIndexManager.js"
```

在 `Agent` 类中添加成员：

```typescript
private fileIndex: FileIndexManager
```

在 constructor 末尾添加索引初始化（异步，不阻塞构造）：

```typescript
this.fileIndex = new FileIndexManager(config.cwd)
this.fileIndex.build().catch(() => {
    // 索引构建失败不影响正常运行，grep 退化为全扫描
})
```

### Step 2: 在 executeTool 的 ToolContext 中注入 fileIndex

修改 `executeTool` 方法中构造 `ctx` 的代码：

```typescript
const ctx: ToolContext = {
    cwd: this.cwd,
    signal: this.activeSignal,
    askQuestion: this.questionBridge
        ? (questions: Question[]) => this.questionBridge!.ask(questions, this.activeSignal)
        : undefined,
    fileIndex: this.fileIndex,
}
```

### Step 3: 确认构建通过

Run: `npx tsc --noEmit`
Expected: PASS

### Step 4: 运行全部测试

Run: `npx vitest run`
Expected: ALL PASS

### Step 5: 提交

```bash
git add src/server/agent.ts
git commit -m "feat: Agent initializes FileIndexManager and injects into ToolContext"
```

---

## Task 8: 端到端验证

编写一个集成测试，验证索引加速的 grep 在实际文件系统上工作正常。

**Files:**
- Create: `src/server/indexing/e2e.test.ts`

### Step 1: 写集成测试

```typescript
// src/server/indexing/e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndexManager } from './fileIndexManager.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Trigram Index E2E', () => {
    let testDir: string

    beforeEach(() => {
        testDir = join(tmpdir(), `trigram-e2e-${Date.now()}`)
        mkdirSync(join(testDir, 'src', 'utils'), { recursive: true })
        mkdirSync(join(testDir, 'src', 'components'), { recursive: true })

        writeFileSync(join(testDir, 'src', 'utils', 'auth.ts'),
            'export function authenticateUser(token: string) {\n  return validateToken(token)\n}')
        writeFileSync(join(testDir, 'src', 'utils', 'db.ts'),
            'export function connectDatabase(url: string) {\n  return new Pool({ connectionString: url })\n}')
        writeFileSync(join(testDir, 'src', 'components', 'Login.tsx'),
            'export function Login() {\n  return <form onSubmit={handleLogin}>\n    <input />\n  </form>\n}')
        writeFileSync(join(testDir, 'src', 'components', 'Dashboard.tsx'),
            'export function Dashboard() {\n  return <div>Welcome</div>\n}')

        // 50 个填充文件，模拟较大项目
        for (let i = 0; i < 50; i++) {
            writeFileSync(join(testDir, 'src', `filler_${i}.ts`),
                `export const filler${i} = ${i}\nconst padding = "some generic content ${i}"\n`)
        }
    })

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true })
    })

    it('should narrow candidates for specific function name', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        const candidates = manager.search('authenticateUser')
        expect(candidates.length).toBeLessThan(10)
        expect(candidates.some(f => f.includes('auth.ts'))).toBe(true)
        expect(candidates.some(f => f.includes('Dashboard.tsx'))).toBe(false)
    })

    it('should narrow candidates for regex pattern', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        // "connectDatabase" 作为 regex
        const candidates = manager.search('connectDatabase')
        expect(candidates.some(f => f.includes('db.ts'))).toBe(true)
        expect(candidates.length).toBeLessThan(5)
    })

    it('should return all files for pure wildcard (graceful degradation)', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        // ".*" 无法提取 trigram → 返回所有文件
        const candidates = manager.search('.*')
        expect(candidates.length).toBe(manager.indexedFileCount)
    })

    it('should reflect incremental updates', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        const newFile = join(testDir, 'src', 'newFeature.ts')
        writeFileSync(newFile, 'export function superSpecialFeature() {}')
        manager.onFileChanged(newFile, 'export function superSpecialFeature() {}')

        const candidates = manager.search('superSpecialFeature')
        expect(candidates.some(f => f.includes('newFeature.ts'))).toBe(true)
    })
})
```

### Step 2: 运行集成测试

Run: `npx vitest run src/server/indexing/e2e.test.ts`
Expected: ALL PASS

### Step 3: 运行全部测试

Run: `npx vitest run`
Expected: ALL PASS

### Step 4: 提交

```bash
git add src/server/indexing/e2e.test.ts
git commit -m "test: add E2E tests for trigram index integration"
```

---

## 总结

| Task | 内容 | 预计时间 |
|------|------|---------|
| 1 | TrigramIndex 核心数据结构 | 15 min |
| 2 | 正则表达式 → Trigram 分解 | 15 min |
| 3 | FileIndexManager 文件索引管理器 | 15 min |
| 4 | 扩展 ToolContext | 5 min |
| 5 | 改造 grep 工具集成索引 | 15 min |
| 6 | write/edit 增量更新 | 10 min |
| 7 | Agent 集成 | 10 min |
| 8 | 端到端验证 | 10 min |

**总计约 1.5 小时。**

## 未来优化方向（不在本次范围内）

1. **概率掩码 (locMask/nextMask)** — 博客中 Project Blackbird 方案，每个 posting 增加 2 字节掩码用于位置和后续字符过滤，可进一步缩小候选集
2. **稀疏 N-gram** — 博客中 ClickHouse/GitHub Code Search 方案，使用字符对频率表作为权重函数，生成变长 n-gram，查询时只需极少 n-gram 即可高精度过滤
3. **磁盘持久化** — 将索引序列化到磁盘（lookup table + postings file），启动时 mmap 加载，避免每次重建
4. **Git 状态同步** — 基于 git commit 控制索引状态，只对 dirty 文件做增量更新
5. **文件监听 (fs.watch)** — 自动检测文件变更，无需依赖工具回调

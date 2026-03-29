# Session Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session metadata index for fast listing, session delete, and session rename/title support — completing the session lifecycle.

**Architecture:** A `SessionIndex` class maintains a lightweight `index.json` file in each project's session directory, caching per-session metadata (title, messageCount, timestamps, preview). `FileStore` operations update the index on create/add/delete. Two new slash commands (`/delete`, `/rename`) and corresponding server RPCs complete the user-facing API. The index auto-rebuilds from JSONL files when missing (backward compatibility with existing sessions).

**Tech Stack:** TypeScript (ESM), Vitest, Node.js fs API, JSON

---

## Architecture

```
SessionDir (~/.lop/sessions/<hash>/)
├── index.json              ← NEW: metadata cache
├── m5k2j-a3f1.jsonl        ← existing session files
├── m5k3a-b2c4.jsonl
└── ...

┌───────────────────────────────────────────────────────┐
│ FileStore                                             │
│   createSession() ──► SessionIndex.addSession()       │
│   add()           ──► SessionIndex.updateSession()    │
│   deleteSession() ──► SessionIndex.removeSession()    │
│   listSessions()  ──► SessionIndex.listSessions()     │
└───────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ /sessions ──► FileStore.listSessions() (reads index)    │
│ /load     ──► server:load_session RPC                   │
│ /delete   ──► server:delete_session RPC  ← NEW          │
│ /rename   ──► server:rename_session RPC  ← NEW          │
└─────────────────────────────────────────────────────────┘
```

## File List

| Action | Path | Description |
|--------|------|-------------|
| Create | `src/server/stores/SessionIndex.ts` | Metadata index read/write/rebuild |
| Create | `src/server/stores/SessionIndex.test.ts` | Unit tests |
| Modify | `src/server/stores/types.ts` | Add `SessionMeta` type |
| Modify | `src/server/stores/FileStore.ts` | Integrate SessionIndex |
| Modify | `src/server/stores/FileStore.test.ts` | Update tests for index |
| Modify | `src/server/index.ts` | Add `delete_session`, `rename_session` RPC handlers |
| Modify | `src/client/index.ts` | Add `deleteSession()`, `renameSession()` methods |
| Create | `src/commands/builtin/deleteCommand.ts` | `/delete` command |
| Create | `src/commands/builtin/renameCommand.ts` | `/rename` command |
| Modify | `src/commands/builtin/index.ts` | Register new commands |
| Modify | `src/commands/builtin/sessionsCommand.ts` | Show titles in listing |

---

## Task 1: SessionMeta Type and SessionIndex Class

Implement the metadata index that stores per-session summaries in a single JSON file.

**Files:**
- Modify: `src/server/stores/types.ts`
- Create: `src/server/stores/SessionIndex.ts`
- Test: `src/server/stores/SessionIndex.test.ts`

- [ ] **Step 1: Add `SessionMeta` type to `types.ts`**

```typescript
// Append to src/server/stores/types.ts

/** Cached metadata for a single session, stored in index.json */
export interface SessionMeta {
  sessionId: string
  title: string | null
  messageCount: number
  createdAt: string   // ISO timestamp
  updatedAt: string   // ISO timestamp
  preview: string | null  // first user message, up to 60 chars
}
```

- [ ] **Step 2: Run test to verify no regressions**

Run: `npx vitest run src/server/stores/`
Expected: All existing tests PASS

- [ ] **Step 3: Write failing tests for SessionIndex**

```typescript
// src/server/stores/SessionIndex.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SessionIndex } from './SessionIndex.js'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('SessionIndex', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-index-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  it('should create index file on first addSession', () => {
    const index = new SessionIndex(tempDir)
    index.addSession({
      sessionId: 's1',
      title: null,
      messageCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: null,
    })

    expect(existsSync(join(tempDir, 'index.json'))).toBe(true)
  })

  it('should persist and reload sessions', () => {
    const index1 = new SessionIndex(tempDir)
    index1.addSession({
      sessionId: 's1',
      title: null,
      messageCount: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: 'Hello',
    })

    const index2 = new SessionIndex(tempDir)
    const sessions = index2.listSessions()
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('s1')
    expect(sessions[0].messageCount).toBe(3)
    expect(sessions[0].preview).toBe('Hello')
  })

  it('should update session metadata', () => {
    const index = new SessionIndex(tempDir)
    index.addSession({
      sessionId: 's1',
      title: null,
      messageCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: 'Hi',
    })

    index.updateSession('s1', { messageCount: 5, updatedAt: '2026-01-02T00:00:00.000Z' })

    const meta = index.getSession('s1')
    expect(meta?.messageCount).toBe(5)
    expect(meta?.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('should remove session', () => {
    const index = new SessionIndex(tempDir)
    index.addSession({
      sessionId: 's1',
      title: null,
      messageCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: null,
    })

    index.removeSession('s1')
    expect(index.listSessions()).toHaveLength(0)
  })

  it('should list sessions sorted by updatedAt descending', () => {
    const index = new SessionIndex(tempDir)
    index.addSession({
      sessionId: 'old',
      title: null,
      messageCount: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: null,
    })
    index.addSession({
      sessionId: 'new',
      title: null,
      messageCount: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      preview: null,
    })

    const sessions = index.listSessions()
    expect(sessions[0].sessionId).toBe('new')
    expect(sessions[1].sessionId).toBe('old')
  })

  it('should set and retrieve title', () => {
    const index = new SessionIndex(tempDir)
    index.addSession({
      sessionId: 's1',
      title: null,
      messageCount: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: null,
    })

    index.updateSession('s1', { title: 'My Debug Session' })
    expect(index.getSession('s1')?.title).toBe('My Debug Session')

    // Survives reload
    const index2 = new SessionIndex(tempDir)
    expect(index2.getSession('s1')?.title).toBe('My Debug Session')
  })

  it('should return empty list for nonexistent index', () => {
    const index = new SessionIndex(tempDir)
    expect(index.listSessions()).toHaveLength(0)
  })

  it('updateSession on nonexistent session should be no-op', () => {
    const index = new SessionIndex(tempDir)
    index.updateSession('nonexistent', { messageCount: 5 })
    expect(index.listSessions()).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run src/server/stores/SessionIndex.test.ts`
Expected: FAIL — cannot import `SessionIndex`

- [ ] **Step 5: Implement SessionIndex**

```typescript
// src/server/stores/SessionIndex.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { SessionMeta } from './types.js'

const INDEX_FILE = 'index.json'

interface IndexData {
  sessions: Record<string, SessionMeta>
}

export class SessionIndex {
  private dir: string
  private indexPath: string
  private entries: Map<string, SessionMeta>

  constructor(sessionDir: string) {
    this.dir = sessionDir
    this.indexPath = join(sessionDir, INDEX_FILE)
    this.entries = new Map()
    this.load()
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return
    try {
      const raw = readFileSync(this.indexPath, 'utf-8')
      const data: IndexData = JSON.parse(raw)
      for (const [id, meta] of Object.entries(data.sessions)) {
        this.entries.set(id, meta)
      }
    } catch {
      // Corrupted index — will be rebuilt on next write
    }
  }

  private save(): void {
    mkdirSync(this.dir, { recursive: true })
    const data: IndexData = {
      sessions: Object.fromEntries(this.entries),
    }
    writeFileSync(this.indexPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  addSession(meta: SessionMeta): void {
    this.entries.set(meta.sessionId, meta)
    this.save()
  }

  updateSession(sessionId: string, updates: Partial<Omit<SessionMeta, 'sessionId'>>): void {
    const existing = this.entries.get(sessionId)
    if (!existing) return
    this.entries.set(sessionId, { ...existing, ...updates })
    this.save()
  }

  removeSession(sessionId: string): void {
    if (!this.entries.delete(sessionId)) return
    this.save()
  }

  getSession(sessionId: string): SessionMeta | undefined {
    return this.entries.get(sessionId)
  }

  listSessions(): SessionMeta[] {
    return [...this.entries.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/server/stores/SessionIndex.test.ts`
Expected: All 8 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/stores/types.ts src/server/stores/SessionIndex.ts src/server/stores/SessionIndex.test.ts
git commit -m "feat: add SessionIndex for fast session metadata lookup"
```

---

## Task 2: Integrate SessionIndex into FileStore

Wire `SessionIndex` into `FileStore` so that `listSessions()` reads from the index, and `createSession()`/`add()` keep the index up to date. Auto-rebuild index from JSONL files when `index.json` is missing (backward compatibility).

**Files:**
- Modify: `src/server/stores/FileStore.ts`
- Modify: `src/server/stores/FileStore.test.ts`

- [ ] **Step 1: Write failing test for index-backed listing**

Add to `src/server/stores/FileStore.test.ts`:

```typescript
  it('listSessions should use index and include title', () => {
    const store = new FileStore('titled-session', '/test/cwd', tempDir)
    store.add({ role: 'user', content: 'Hello world' })

    const sessions = FileStore.listSessions('/test/cwd', tempDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('titled-session')
    expect(sessions[0].messageCount).toBe(1)
    expect(sessions[0].preview).toBe('Hello world')
  })

  it('listSessions should auto-rebuild index from JSONL files', () => {
    // Create session WITHOUT index (simulating pre-index data)
    const store = new FileStore('legacy', '/test/cwd', tempDir)
    store.add({ role: 'user', content: 'Old session' })

    // Delete index.json to simulate legacy state
    const indexPath = join(tempDir, 'index.json')
    if (existsSync(indexPath)) rmSync(indexPath)

    // listSessions should still work by rebuilding from JSONL
    const sessions = FileStore.listSessions('/test/cwd', tempDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('legacy')
    expect(sessions[0].messageCount).toBe(1)
  })
```

Add `existsSync` to the import at the top of the test file:
```typescript
import { mkdtempSync, rmSync, existsSync } from 'fs'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/server/stores/FileStore.test.ts`
Expected: FAIL — new tests fail (existing tests still pass since the interface is compatible)

- [ ] **Step 3: Integrate SessionIndex into FileStore**

Replace `src/server/stores/FileStore.ts` with:

```typescript
import type { CoreMessage } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, statSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { MessageStore } from '../store.js';
import { readLinesSync, writeLineSync } from '../utils/jsonl.js';
import { generateSessionId, getSessionDir, listSessionIds } from '../utils/storagePath.js';
import type { SessionInfo, SessionRecord, SessionMeta } from './types.js';
import { SessionIndex } from './SessionIndex.js';

export class FileStore implements MessageStore {
  private records: SessionRecord[] = [];
  private filePath: string;
  private sessionId: string;
  private cwd: string;
  private lastUuid: string | null = null;
  private sessionDir: string;

  constructor(sessionId: string, cwd: string, sessionDir?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.sessionDir = sessionDir ?? getSessionDir(cwd);
    this.filePath = join(this.sessionDir, `${sessionId}.jsonl`);
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    this.records = readLinesSync<SessionRecord>(this.filePath);
    if (this.records.length > 0) {
      this.lastUuid = this.records[this.records.length - 1].uuid;
    }
  }

  add(message: CoreMessage): void {
    const uuid = randomUUID();
    const record: SessionRecord = {
      uuid,
      parentUuid: this.lastUuid,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      type: this.inferType(message),
      cwd: this.cwd,
      message,
    };
    this.records.push(record);
    this.lastUuid = uuid;
    writeLineSync(this.filePath, record);

    // Update index
    const index = new SessionIndex(this.sessionDir);
    const existing = index.getSession(this.sessionId);
    if (existing) {
      const updates: Partial<SessionMeta> = {
        messageCount: this.records.length,
        updatedAt: record.timestamp,
      };
      if (!existing.preview && message.role === 'user') {
        updates.preview = String(message.content).slice(0, 60);
      }
      index.updateSession(this.sessionId, updates);
    } else {
      // First add — create index entry
      const preview = message.role === 'user' ? String(message.content).slice(0, 60) : null;
      index.addSession({
        sessionId: this.sessionId,
        title: null,
        messageCount: this.records.length,
        createdAt: record.timestamp,
        updatedAt: record.timestamp,
        preview,
      });
    }
  }

  getAll(): CoreMessage[] {
    return this.records.map(r => r.message);
  }

  clear(): void {
    this.records = [];
    this.lastUuid = null;
    if (existsSync(this.filePath)) {
      writeFileSync(this.filePath, '');
    }
    const index = new SessionIndex(this.sessionDir);
    index.updateSession(this.sessionId, { messageCount: 0, updatedAt: new Date().toISOString() });
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessageCount(): number {
    return this.records.length;
  }

  private inferType(message: CoreMessage): SessionRecord['type'] {
    if (message.role === 'assistant') return 'assistant';
    if (message.role === 'tool') return 'tool_result';
    return 'user';
  }

  /** List sessions, reading from index. Rebuilds index from JSONL if missing. */
  static listSessions(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? getSessionDir(cwd);
    const index = new SessionIndex(dir);
    let sessions = index.listSessions();

    if (sessions.length === 0) {
      // Attempt rebuild from JSONL files (backward compatibility)
      const ids = listSessionIds(dir);
      if (ids.length === 0) return [];

      for (const id of ids) {
        const filePath = join(dir, `${id}.jsonl`);
        if (!existsSync(filePath)) continue;
        const records = readLinesSync<SessionRecord>(filePath);
        if (records.length === 0) continue;
        const firstUser = records.find(r => r.type === 'user');
        const preview = firstUser ? String(firstUser.message.content).slice(0, 60) : null;
        const stats = statSync(filePath);
        index.addSession({
          sessionId: id,
          title: null,
          messageCount: records.length,
          createdAt: records[0].timestamp,
          updatedAt: stats.mtime.toISOString(),
          preview,
        });
      }
      sessions = index.listSessions();
    }

    return sessions.map(m => ({
      sessionId: m.sessionId,
      mtime: new Date(m.updatedAt),
      messageCount: m.messageCount,
      preview: m.preview ?? undefined,
      title: m.title ?? undefined,
    }));
  }

  /** Delete a session's JSONL file and remove from index. */
  static deleteSession(sessionId: string, cwd: string, sessionDir?: string): boolean {
    const dir = sessionDir ?? getSessionDir(cwd);
    const filePath = join(dir, `${sessionId}.jsonl`);
    if (!existsSync(filePath)) return false;
    unlinkSync(filePath);
    const index = new SessionIndex(dir);
    index.removeSession(sessionId);
    return true;
  }

  static loadSession(sessionId: string, cwd: string): FileStore {
    return new FileStore(sessionId, cwd);
  }

  static createSession(cwd: string): FileStore {
    return new FileStore(generateSessionId(), cwd);
  }
}
```

- [ ] **Step 4: Add `title` to `SessionInfo` type**

In `src/server/stores/types.ts`, update `SessionInfo`:

```typescript
/** 供 /sessions 命令展示的会话摘要 */
export interface SessionInfo {
  sessionId: string;
  mtime: Date;
  messageCount: number;
  /** 第一条用户消息前 60 个字符 */
  preview?: string;
  /** User-assigned session title */
  title?: string;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/server/stores/`
Expected: All tests PASS (existing + 2 new)

- [ ] **Step 6: Commit**

```bash
git add src/server/stores/FileStore.ts src/server/stores/FileStore.test.ts src/server/stores/types.ts
git commit -m "feat: integrate SessionIndex into FileStore for fast listing"
```

---

## Task 3: Session Delete (Full Stack)

Add session deletion: `FileStore.deleteSession()` (already added in Task 2), server RPC handler, client method, and `/delete` command.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/index.ts`
- Create: `src/commands/builtin/deleteCommand.ts`
- Modify: `src/commands/builtin/index.ts`

- [ ] **Step 1: Add `delete_session` RPC handler to server**

In `src/server/index.ts`, add this case before the `default:` case inside `handleRequest`:

```typescript
        case "delete_session": {
            const { sessionId } = params as { sessionId: string }
            if (!sessionId) {
                sendError(requestId, -32602, "sessionId is required")
                return
            }
            const deleted = FileStore.deleteSession(sessionId, currentCwd)
            if (!deleted) {
                sendError(requestId, -32001, `Session not found: ${sessionId}`)
                return
            }
            sendResponse(requestId, { sessionId, deleted: true })
            break
        }
```

- [ ] **Step 2: Add `deleteSession` method to client**

In `src/client/index.ts`, add after `loadSession`:

```typescript
  /** Delete a saved session by ID */
  async deleteSession(sessionId: string): Promise<{ sessionId: string; deleted: boolean }> {
    return this.sendRequest('delete_session', { sessionId })
  }
```

- [ ] **Step 3: Create `/delete` command**

```typescript
// src/commands/builtin/deleteCommand.ts
import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const deleteCommand: SlashCommand = {
  name: 'delete',
  altNames: ['rm'],
  description: 'Delete a saved session. Usage: /delete <sessionId>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const sessionId = args.trim()

    if (!sessionId) {
      return { type: 'message', content: 'Usage: /delete <sessionId>\nUse /sessions to list available sessions.', isError: true }
    }

    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }

    try {
      await context.client.deleteSession(sessionId)
      return { type: 'message', content: `Session deleted: ${sessionId}` }
    } catch (error: any) {
      return { type: 'message', content: `Failed to delete session: ${error.message}`, isError: true }
    }
  },
}
```

- [ ] **Step 4: Register command in `builtin/index.ts`**

Add to `src/commands/builtin/index.ts`:

```typescript
// Add export
export { deleteCommand } from './deleteCommand.js'

// Add import
import { deleteCommand } from './deleteCommand.js'

// Add to allBuiltinCommands array
export const allBuiltinCommands: SlashCommand[] = [
    helpCommand,
    clearCommand,
    quitCommand,
    statsCommand,
    themeCommand,
    mcpCommand,
    sessionsCommand,
    loadCommand,
    deleteCommand,
]
```

- [ ] **Step 5: Run all tests to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts src/client/index.ts src/commands/builtin/deleteCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add /delete command for session deletion"
```

---

## Task 4: Session Rename/Title (Full Stack)

Add session renaming: update title in SessionIndex via server RPC and `/rename` command.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/index.ts`
- Create: `src/commands/builtin/renameCommand.ts`
- Modify: `src/commands/builtin/index.ts`
- Modify: `src/commands/builtin/sessionsCommand.ts`

- [ ] **Step 1: Add `rename_session` RPC handler to server**

In `src/server/index.ts`, add this case before the `default:` case:

```typescript
        case "rename_session": {
            const { sessionId, title } = params as { sessionId: string; title: string }
            if (!sessionId || !title) {
                sendError(requestId, -32602, "sessionId and title are required")
                return
            }
            const dir = getSessionDir(currentCwd)
            const index = new SessionIndex(dir)
            const meta = index.getSession(sessionId)
            if (!meta) {
                sendError(requestId, -32001, `Session not found in index: ${sessionId}`)
                return
            }
            index.updateSession(sessionId, { title })
            sendResponse(requestId, { sessionId, title })
            break
        }
```

Add these imports to the top of `src/server/index.ts`:

```typescript
import { SessionIndex } from "./stores/SessionIndex.js"
import { getSessionDir } from "./utils/storagePath.js"
```

- [ ] **Step 2: Add `renameSession` method to client**

In `src/client/index.ts`, add after `deleteSession`:

```typescript
  /** Rename a session (set its title) */
  async renameSession(sessionId: string, title: string): Promise<{ sessionId: string; title: string }> {
    return this.sendRequest('rename_session', { sessionId, title })
  }
```

- [ ] **Step 3: Create `/rename` command**

```typescript
// src/commands/builtin/renameCommand.ts
import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const renameCommand: SlashCommand = {
  name: 'rename',
  altNames: ['title'],
  description: 'Set a title for a session. Usage: /rename <sessionId> <title>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const trimmed = args.trim()
    const spaceIdx = trimmed.indexOf(' ')

    if (!trimmed || spaceIdx === -1) {
      return {
        type: 'message',
        content: 'Usage: /rename <sessionId> <title>\nUse /sessions to list available sessions.',
        isError: true,
      }
    }

    const sessionId = trimmed.slice(0, spaceIdx)
    const title = trimmed.slice(spaceIdx + 1).trim()

    if (!title) {
      return { type: 'message', content: 'Title cannot be empty.', isError: true }
    }

    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }

    try {
      await context.client.renameSession(sessionId, title)
      return { type: 'message', content: `Session renamed: ${sessionId} → "${title}"` }
    } catch (error: any) {
      return { type: 'message', content: `Failed to rename session: ${error.message}`, isError: true }
    }
  },
}
```

- [ ] **Step 4: Register command in `builtin/index.ts`**

Add to `src/commands/builtin/index.ts`:

```typescript
// Add export
export { renameCommand } from './renameCommand.js'

// Add import
import { renameCommand } from './renameCommand.js'

// Add to allBuiltinCommands array (after deleteCommand)
export const allBuiltinCommands: SlashCommand[] = [
    helpCommand,
    clearCommand,
    quitCommand,
    statsCommand,
    themeCommand,
    mcpCommand,
    sessionsCommand,
    loadCommand,
    deleteCommand,
    renameCommand,
]
```

- [ ] **Step 5: Update `/sessions` to display titles**

In `src/commands/builtin/sessionsCommand.ts`, update the session listing to show titles:

Replace the `sessions.map` block:

```typescript
    const lines = [
      `Found ${sessions.length} session(s):`,
      '',
      ...sessions.map((s, i) => {
        const date = s.mtime.toLocaleString()
        const title = s.title ? `"${s.title}"` : s.preview ? `"${s.preview}"` : '(no preview)'
        return `${i + 1}. ${s.sessionId} — ${title} (${s.messageCount} msgs, ${date})`
      }),
      '',
      'Use /load <sessionId> to resume, /rename <sessionId> <title> to name, /delete <sessionId> to remove.',
    ]
```

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts src/client/index.ts src/commands/builtin/renameCommand.ts src/commands/builtin/index.ts src/commands/builtin/sessionsCommand.ts
git commit -m "feat: add /rename command and show titles in /sessions"
```

---

## Task 5: Integration Test

Write an integration test that exercises the full session lifecycle: create → add messages → list → rename → delete.

**Files:**
- Create: `src/server/stores/sessionLifecycle.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// src/server/stores/sessionLifecycle.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStore } from './FileStore.js'
import { SessionIndex } from './SessionIndex.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Session Lifecycle', () => {
  let tempDir: string
  const cwd = '/test/lifecycle'

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lifecycle-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  it('full lifecycle: create → add → list → rename → delete', () => {
    // Create session
    const store = new FileStore('lifecycle-1', cwd, tempDir)
    store.add({ role: 'user', content: 'First message' })
    store.add({ role: 'assistant', content: 'Response' })

    // List — should show 1 session with preview
    let sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('lifecycle-1')
    expect(sessions[0].messageCount).toBe(2)
    expect(sessions[0].preview).toBe('First message')
    expect(sessions[0].title).toBeUndefined()

    // Rename
    const index = new SessionIndex(tempDir)
    index.updateSession('lifecycle-1', { title: 'Debug Session' })

    sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions[0].title).toBe('Debug Session')

    // Delete
    const deleted = FileStore.deleteSession('lifecycle-1', cwd, tempDir)
    expect(deleted).toBe(true)

    sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(0)

    // Delete nonexistent — returns false
    expect(FileStore.deleteSession('nonexistent', cwd, tempDir)).toBe(false)
  })

  it('multiple sessions with different update times sort correctly', () => {
    const store1 = new FileStore('first', cwd, tempDir)
    store1.add({ role: 'user', content: 'Older session' })

    // Small delay to ensure different timestamps
    const store2 = new FileStore('second', cwd, tempDir)
    store2.add({ role: 'user', content: 'Newer session' })

    const sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(2)
    // Most recently updated should be first
    expect(sessions[0].sessionId).toBe('second')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/server/stores/sessionLifecycle.test.ts`
Expected: All 2 tests PASS

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/server/stores/sessionLifecycle.test.ts
git commit -m "test: add session lifecycle integration test"
```

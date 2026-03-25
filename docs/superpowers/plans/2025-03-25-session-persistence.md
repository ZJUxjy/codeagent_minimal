# 文件持久化会话存储系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于 JSONL 文件的会话持久化系统，支持会话保存、加载和列表，保持与现有 InMemoryStore 接口兼容。

**Architecture:** 采用追加写入的 JSONL 文件格式存储会话记录，通过 `FileStore` 类实现 `MessageStore` 接口，提供即时持久化和会话恢复功能。会话按项目（工作目录哈希）隔离存储在 `~/.lop/sessions/<project_hash>/`。`/load` 命令通过已有的 JSON-RPC 协议扩展实现会话加载，服务器收到请求后替换 Agent 的 store 实例。

**Tech Stack:** TypeScript, Node.js fs API (同步), crypto (SHA256 哈希), 现有 JSON-RPC 协议

---

## File Structure

```
src/
├── server/
│   ├── store.ts                    # 已有：MessageStore 接口 + InMemoryStore；新增 replaceStore 导出
│   ├── agent.ts                    # 修改：新增 replaceStore(store) 公共方法
│   ├── index.ts                    # 修改：新增 load_session RPC handler；启动时读取 LOP_PERSISTENCE env
│   ├── stores/
│   │   ├── FileStore.ts            # 新建：文件持久化存储实现
│   │   └── types.ts                # 新建：SessionRecord、SessionInfo 类型
│   └── utils/
│       ├── jsonl.ts                # 已有：writeLineSync + readLinesSync（Task 1 验证即可）
│       ├── jsonl.test.ts           # 已有
│       └── storagePath.ts          # 新建：路径管理工具
├── client/
│   └── index.ts                    # 修改：新增 loadSession(sessionId) 方法
├── commands/builtin/
│   ├── index.ts                    # 修改：注册 sessionsCommand、loadCommand
│   ├── sessionsCommand.ts          # 新建：/sessions 命令
│   └── loadCommand.ts              # 新建：/load 命令
└── protocol/
    └── types.ts                    # 修改：LopConfig 新增 persistence 字段
```

---

## Task 1: 验证 JSONL 工具模块（已实现）

**Files:**
- Verify: `src/server/utils/jsonl.ts`
- Verify: `src/server/utils/jsonl.test.ts`

**Background:** `jsonl.ts` 在此计划制定前已实现，直接验证测试通过即可。

- [ ] **Step 1: 运行现有测试确认通过**

Run: `npx vitest run src/server/utils/jsonl.test.ts`
Expected: All tests PASS

如果测试失败，检查 `src/server/utils/jsonl.ts` 中 `writeLineSync` 和 `readLinesSync` 的实现，确保：
- `readLinesSync` 对不存在的文件返回空数组
- `writeLineSync` 自动创建父目录

---

## Task 2: 存储路径管理

**Files:**
- Create: `src/server/utils/storagePath.ts`
- Create: `src/server/utils/storagePath.test.ts`

**Background:** 会话存储路径：`~/.lop/sessions/<project_hash>/<session_id>.jsonl`。`project_hash` 是工作目录路径的 SHA256 前16位，用于项目隔离。

- [ ] **Step 1: 写失败测试**

Create `src/server/utils/storagePath.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getBaseDir, getSessionDir, getSessionFilePath, sanitizeCwd, generateSessionId, listSessionIds } from './storagePath.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('storagePath', () => {
  describe('getBaseDir', () => {
    it('should return .lop in home directory', () => {
      expect(getBaseDir()).toBe(join(homedir(), '.lop'));
    });
  });

  describe('sanitizeCwd', () => {
    it('should return 16-char hex string', () => {
      const result = sanitizeCwd('/home/user/project');
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be deterministic', () => {
      expect(sanitizeCwd('/home/user/project')).toBe(sanitizeCwd('/home/user/project'));
    });

    it('should differ for different paths', () => {
      expect(sanitizeCwd('/path/a')).not.toBe(sanitizeCwd('/path/b'));
    });
  });

  describe('getSessionDir', () => {
    it('should include sessions dir and project hash', () => {
      const dir = getSessionDir('/home/user/proj');
      expect(dir).toBe(join(homedir(), '.lop', 'sessions', sanitizeCwd('/home/user/proj')));
    });
  });

  describe('getSessionFilePath', () => {
    it('should return path ending with sessionId.jsonl', () => {
      const p = getSessionFilePath('/my/proj', 'abc123');
      expect(p).toEndWith('abc123.jsonl');
    });
  });

  describe('generateSessionId', () => {
    it('should generate unique IDs', () => {
      expect(generateSessionId()).not.toBe(generateSessionId());
    });

    it('should be at least 8 chars', () => {
      expect(generateSessionId().length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('listSessionIds', () => {
    it('should return empty array for non-existent dir', () => {
      expect(listSessionIds('/nonexistent/dir')).toEqual([]);
    });

    it('should list .jsonl filenames without extension', () => {
      const dir = mkdtempSync(join(tmpdir(), 'sp-test-'));
      try {
        writeFileSync(join(dir, 'sess1.jsonl'), '');
        writeFileSync(join(dir, 'sess2.jsonl'), '');
        writeFileSync(join(dir, 'other.txt'), '');
        const ids = listSessionIds(dir);
        expect(ids).toContain('sess1');
        expect(ids).toContain('sess2');
        expect(ids).not.toContain('other');
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/server/utils/storagePath.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 storagePath 工具**

Create `src/server/utils/storagePath.ts`:

```typescript
import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const BASE_DIR_NAME = '.lop';
const SESSIONS_DIR_NAME = 'sessions';

/** 获取基础存储目录（~/.lop） */
export function getBaseDir(): string {
  return join(homedir(), BASE_DIR_NAME);
}

/** 将工作目录路径映射到 16 字符 hex 哈希 */
export function sanitizeCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

/** 获取指定项目的会话存储目录 */
export function getSessionDir(cwd: string): string {
  return join(getBaseDir(), SESSIONS_DIR_NAME, sanitizeCwd(cwd));
}

/** 获取会话 JSONL 文件完整路径 */
export function getSessionFilePath(cwd: string, sessionId: string): string {
  return join(getSessionDir(cwd), `${sessionId}.jsonl`);
}

/** 生成唯一会话 ID（时间戳+随机） */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${random}`;
}

/** 列出指定目录中的所有会话 ID（不含 .jsonl 后缀） */
export function listSessionIds(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return [];
  return readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.slice(0, -6));
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/server/utils/storagePath.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/storagePath.ts src/server/utils/storagePath.test.ts
git commit -m "feat: add storage path utilities for session management"
```

---

## Task 3: SessionRecord 类型定义

**Files:**
- Create: `src/server/stores/types.ts`

- [ ] **Step 1: 创建类型文件**

Create `src/server/stores/types.ts`:

```typescript
import type { CoreMessage } from 'ai';

/** 存储在 JSONL 文件中的一条会话记录 */
export interface SessionRecord {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_result';
  cwd: string;
  message: CoreMessage;
}

/** 供 /sessions 命令展示的会话摘要 */
export interface SessionInfo {
  sessionId: string;
  mtime: Date;
  messageCount: number;
  /** 第一条用户消息前 60 个字符 */
  preview?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/stores/types.ts
git commit -m "feat: add session record types"
```

---

## Task 4: FileStore 实现

**Files:**
- Create: `src/server/stores/FileStore.ts`
- Create: `src/server/stores/FileStore.test.ts`

**关键设计决策：**
- 构造函数接受可选的 `sessionDir` 参数（测试隔离用）；不传时使用 `getSessionDir(cwd)`
- `clear()` 截断文件内容（与 InMemoryStore 语义一致：清空即清空）
- 所有 `storagePath` 工具函数使用静态 import（非 `require()`）

- [ ] **Step 1: 写失败测试**

Create `src/server/stores/FileStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from './FileStore.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'filestore-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should add and retrieve messages', () => {
    const store = new FileStore('s1', '/test/cwd', tempDir);
    store.add({ role: 'user', content: 'Hello' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].content).toBe('Hello');
  });

  it('should persist messages across instances', () => {
    const store1 = new FileStore('s1', '/test/cwd', tempDir);
    store1.add({ role: 'user', content: 'Hello' });
    store1.add({ role: 'assistant', content: 'Hi!' });

    const store2 = new FileStore('s1', '/test/cwd', tempDir);
    expect(store2.getAll()).toHaveLength(2);
    expect(store2.getAll()[0].content).toBe('Hello');
  });

  it('should clear messages in memory and on disk', () => {
    const store1 = new FileStore('s1', '/test/cwd', tempDir);
    store1.add({ role: 'user', content: 'Hello' });
    store1.clear();

    expect(store1.getAll()).toHaveLength(0);

    // 新实例读同一文件也应为空
    const store2 = new FileStore('s1', '/test/cwd', tempDir);
    expect(store2.getAll()).toHaveLength(0);
  });

  it('should list sessions in sessionDir', () => {
    const store = new FileStore('my-session', '/test/cwd', tempDir);
    store.add({ role: 'user', content: 'Hi' });

    const sessions = FileStore.listSessions('/test/cwd', tempDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('my-session');
    expect(sessions[0].messageCount).toBe(1);
    expect(sessions[0].preview).toBe('Hi');
  });

  it('getSessionId should return the session id', () => {
    const store = new FileStore('test-id', '/test/cwd', tempDir);
    expect(store.getSessionId()).toBe('test-id');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/server/stores/FileStore.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: 实现 FileStore**

Create `src/server/stores/FileStore.ts`:

```typescript
import type { CoreMessage } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MessageStore } from '../store.js';
import { readLinesSync, writeLineSync } from '../utils/jsonl.js';
import { generateSessionId, getSessionDir, getSessionFilePath, listSessionIds } from '../utils/storagePath.js';
import type { SessionInfo, SessionRecord } from './types.js';

export class FileStore implements MessageStore {
  private records: SessionRecord[] = [];
  private filePath: string;
  private sessionId: string;
  private cwd: string;
  private lastUuid: string | null = null;

  /**
   * @param sessionId  会话唯一标识
   * @param cwd        工作目录（用于生成默认存储路径）
   * @param sessionDir 可选：自定义会话目录（测试隔离用）
   */
  constructor(sessionId: string, cwd: string, sessionDir?: string) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    const dir = sessionDir ?? getSessionDir(cwd);
    this.filePath = join(dir, `${sessionId}.jsonl`);
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
  }

  getAll(): CoreMessage[] {
    return this.records.map(r => r.message);
  }

  /** 清空内存和磁盘（截断文件）。与 InMemoryStore.clear() 语义一致。 */
  clear(): void {
    this.records = [];
    this.lastUuid = null;
    if (existsSync(this.filePath)) {
      writeFileSync(this.filePath, '');
    }
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

  /** 列出指定目录的所有会话，按最后修改时间倒序 */
  static listSessions(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? getSessionDir(cwd);
    return listSessionIds(dir)
      .map(id => {
        const filePath = join(dir, `${id}.jsonl`);
        if (!existsSync(filePath)) return null;
        const stats = statSync(filePath);
        const records = readLinesSync<SessionRecord>(filePath);
        const firstUser = records.find(r => r.type === 'user');
        const preview = firstUser
          ? String(firstUser.message.content).slice(0, 60)
          : undefined;
        return { sessionId: id, mtime: stats.mtime, messageCount: records.length, preview } satisfies SessionInfo;
      })
      .filter((s): s is SessionInfo => s !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  /** 加载已有会话（从默认路径） */
  static loadSession(sessionId: string, cwd: string): FileStore {
    return new FileStore(sessionId, cwd);
  }

  /** 创建新会话（从默认路径） */
  static createSession(cwd: string): FileStore {
    return new FileStore(generateSessionId(), cwd);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/server/stores/FileStore.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/stores/types.ts src/server/stores/FileStore.ts src/server/stores/FileStore.test.ts
git commit -m "feat: implement FileStore for session persistence"
```

---

## Task 5: 配置扩展 + Agent.replaceStore

**Files:**
- Modify: `src/protocol/types.ts:115-127`
- Modify: `src/server/agent.ts`

- [ ] **Step 1: 在 LopConfig 中添加 persistence 字段**

Modify `src/protocol/types.ts` — 在 `LopConfig` 接口末尾添加：

```typescript
export interface LopConfig {
  provider?: Provider
  model?: string
  apiKey?: string
  baseURL?: string
  debug?: boolean
  token?: string
  url?: string
  mcpServers?: Record<string, McpServerConfig>
  mcp?: { allowed?: string[]; excluded?: string[] }
  // 新增：会话持久化开关
  persistence?: {
    enabled?: boolean
  }
}
```

- [ ] **Step 2: 在 Agent 中新增 replaceStore 方法**

Modify `src/server/agent.ts` — 在 `clearHistory()` 方法后添加：

```typescript
/** 替换底层 store（用于 /load 命令加载历史会话） */
replaceStore(newStore: MessageStore): void {
  this.store = newStore
}
```

- [ ] **Step 3: Commit**

```bash
git add src/protocol/types.ts src/server/agent.ts
git commit -m "feat: add persistence config and Agent.replaceStore method"
```

---

## Task 6: 服务器集成 FileStore

**Files:**
- Modify: `src/server/index.ts`

**Background:** 服务器通过环境变量 `LOP_PERSISTENCE=true` 决定是否启用持久化。启用时，`initialize` 阶段创建 FileStore 并注入 Agent；新增 `load_session` RPC handler，用于替换 Agent 的 store。

- [ ] **Step 1: 修改 server/index.ts**

在文件顶部新增导入（放在现有 import 语句之后）：

```typescript
import { FileStore } from './stores/FileStore.js'
import { generateSessionId } from './utils/storagePath.js'
```

修改 `buildServerAgentConfig` 为接受可选 store：

```typescript
function buildServerAgentConfig(cwd: string, store?: MessageStore): AgentConfig {
  return {
    provider: (process.env.LOP_PROVIDER as AgentConfig["provider"]) ?? "openai",
    model: process.env.LOP_MODEL ?? "gpt-4o",
    apiKey: process.env.LOP_API_KEY,
    baseURL: process.env.LOP_BASE_URL,
    cwd,
    debug: process.env.LOP_DEBUG === "true",
    mcpConfig: getMcpConfigFromEnv(),
    ...(store ? { store } : {}),
  }
}
```

在 `handleRequest` 的 `switch` 中，将 `"initialize"` case 替换为：

```typescript
case "initialize": {
  let store: MessageStore | undefined
  if (process.env.LOP_PERSISTENCE === "true") {
    store = FileStore.createSession(currentCwd)
    debugLog("server", `Persistence enabled, session: ${(store as FileStore).getSessionId()}`)
  }
  const config = buildServerAgentConfig(currentCwd, store)

  debugLog("server", `Config: provider=${config.provider}, model=${config.model}`)
  debugLog("server", `API Key: ${config.apiKey?.slice(0, 10)}...`)
  debugLog("server", `Base URL: ${config.baseURL}`)

  agent = new Agent(config)

  if (config.mcpConfig?.mcpServers && Object.keys(config.mcpConfig.mcpServers).length > 0) {
    agent.discoverMcpTools().catch((err) => {
      debugLog("server", "MCP discovery failed:", err)
    })
  }

  sendResponse(requestId, {
    serverInfo: { name: "lop_minimal_server", version: "0.1.0" },
    capabilities: {},
  })
  break
}
```

新增 `load_session` case（放在 `"clear"` case 之后）：

```typescript
case "load_session": {
  if (!agent) {
    sendError(requestId, -32002, "Not initialized")
    return
  }
  const { sessionId } = params as { sessionId: string }
  if (!sessionId) {
    sendError(requestId, -32602, "sessionId is required")
    return
  }
  const loadedStore = FileStore.loadSession(sessionId, currentCwd)
  if (loadedStore.getMessageCount() === 0) {
    sendError(requestId, -32001, `Session not found or empty: ${sessionId}`)
    return
  }
  agent.replaceStore(loadedStore)
  sendResponse(requestId, { sessionId, messageCount: loadedStore.getMessageCount() })
  break
}
```

- [ ] **Step 2: 构建确认无 TS 错误**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: integrate FileStore into server with LOP_PERSISTENCE env var"
```

---

## Task 7: 客户端新增 loadSession 方法

**Files:**
- Modify: `src/client/index.ts`

- [ ] **Step 1: 在 Client 类中添加 loadSession 方法**

Modify `src/client/index.ts` — 在 `mcpReload` 方法后添加：

```typescript
/** 加载历史会话（替换当前 Agent store） */
async loadSession(sessionId: string): Promise<{ sessionId: string; messageCount: number }> {
  return this.sendRequest('load_session', { sessionId })
}
```

- [ ] **Step 2: 构建确认**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 3: Commit**

```bash
git add src/client/index.ts
git commit -m "feat: add client.loadSession() method"
```

---

## Task 8: /sessions 命令

**Files:**
- Create: `src/commands/builtin/sessionsCommand.ts`

- [ ] **Step 1: 实现 /sessions 命令**

Create `src/commands/builtin/sessionsCommand.ts`:

```typescript
import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'
import { FileStore } from '../../server/stores/FileStore.js'

export const sessionsCommand: SlashCommand = {
  name: 'sessions',
  altNames: ['list'],
  description: 'List all saved sessions for current project',
  kind: CommandKind.BUILT_IN,

  action: (_context: CommandContext, _args: string): SlashCommandActionReturn => {
    const cwd = process.cwd()
    const sessions = FileStore.listSessions(cwd)

    if (sessions.length === 0) {
      return { type: 'message', content: 'No saved sessions found. Enable persistence with LOP_PERSISTENCE=true.' }
    }

    const lines = [
      `Found ${sessions.length} session(s):`,
      '',
      ...sessions.map((s, i) => {
        const date = s.mtime.toLocaleString()
        const preview = s.preview ? ` — "${s.preview}"` : ''
        return `${i + 1}. ${s.sessionId} (${s.messageCount} msgs, ${date})${preview}`
      }),
      '',
      'Use /load <sessionId> to resume a session.',
    ]

    return { type: 'message', content: lines.join('\n') }
  },
}
```

- [ ] **Step 2: 注册命令**

Modify `src/commands/builtin/index.ts`:

```typescript
// 内置命令索引
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { themeCommand } from './themeCommand.js'
export { mcpCommand } from './mcpCommand.js'
export { sessionsCommand } from './sessionsCommand.js'

// 所有内置命令列表
import { helpCommand } from './helpCommand.js'
import { clearCommand } from './clearCommand.js'
import { quitCommand } from './quitCommand.js'
import { statsCommand } from './statsCommand.js'
import { themeCommand } from './themeCommand.js'
import { mcpCommand } from './mcpCommand.js'
import { sessionsCommand } from './sessionsCommand.js'
import type { SlashCommand } from '../types.js'

export const allBuiltinCommands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  quitCommand,
  statsCommand,
  themeCommand,
  mcpCommand,
  sessionsCommand,
]
```

- [ ] **Step 3: 构建确认**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/builtin/sessionsCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add /sessions command to list saved sessions"
```

---

## Task 9: /load 命令

**Files:**
- Create: `src/commands/builtin/loadCommand.ts`
- Modify: `src/commands/builtin/index.ts`

- [ ] **Step 1: 实现 /load 命令**

Create `src/commands/builtin/loadCommand.ts`:

```typescript
import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const loadCommand: SlashCommand = {
  name: 'load',
  altNames: ['resume'],
  description: 'Load a previous session by ID. Usage: /load <sessionId>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const sessionId = args.trim()

    if (!sessionId) {
      return { type: 'message', content: 'Usage: /load <sessionId>\nUse /sessions to list available sessions.', isError: true }
    }

    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }

    try {
      const result = await context.client.loadSession(sessionId)
      context.ui.clearMessages()
      return {
        type: 'message',
        content: `Session loaded: ${result.sessionId} (${result.messageCount} messages restored)`,
      }
    } catch (error: any) {
      return { type: 'message', content: `Failed to load session: ${error.message}`, isError: true }
    }
  },
}
```

- [ ] **Step 2: 注册命令（完整文件）**

Overwrite `src/commands/builtin/index.ts` with the final state (includes both sessionsCommand and loadCommand):

```typescript
// 内置命令索引
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { themeCommand } from './themeCommand.js'
export { mcpCommand } from './mcpCommand.js'
export { sessionsCommand } from './sessionsCommand.js'
export { loadCommand } from './loadCommand.js'

// 所有内置命令列表
import { helpCommand } from './helpCommand.js'
import { clearCommand } from './clearCommand.js'
import { quitCommand } from './quitCommand.js'
import { statsCommand } from './statsCommand.js'
import { themeCommand } from './themeCommand.js'
import { mcpCommand } from './mcpCommand.js'
import { sessionsCommand } from './sessionsCommand.js'
import { loadCommand } from './loadCommand.js'
import type { SlashCommand } from '../types.js'

export const allBuiltinCommands: SlashCommand[] = [
  helpCommand,
  clearCommand,
  quitCommand,
  statsCommand,
  themeCommand,
  mcpCommand,
  sessionsCommand,
  loadCommand,
]
```

- [ ] **Step 3: 构建确认**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add src/commands/builtin/loadCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add /load command to resume saved sessions"
```

---

## Task 10: 集成测试

**Files:**
- Create: `src/__tests__/persistence.integration.test.ts`

- [ ] **Step 1: 写集成测试**

Create `src/__tests__/persistence.integration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../server/stores/FileStore.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Persistence Integration', () => {
  let tempDir: string;
  const cwd = '/test/project/path';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'persist-int-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should persist and restore full conversation', () => {
    const store1 = new FileStore('session-a', cwd, tempDir);
    store1.add({ role: 'user', content: 'Hello AI' });
    store1.add({ role: 'assistant', content: 'Hello! How can I help?' });
    store1.add({ role: 'user', content: 'What is the weather?' });

    const store2 = new FileStore('session-a', cwd, tempDir);
    const messages = store2.getAll();
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('Hello AI');
    expect(messages[1].content).toBe('Hello! How can I help?');
    expect(messages[2].content).toBe('What is the weather?');
  });

  it('should list sessions sorted by mtime descending', async () => {
    const store1 = new FileStore('session-first', cwd, tempDir);
    store1.add({ role: 'user', content: 'First session' });

    // 等待 2ms 保证 mtime 不同
    await new Promise(r => setTimeout(r, 2));

    const store2 = new FileStore('session-second', cwd, tempDir);
    store2.add({ role: 'user', content: 'Second session' });

    const sessions = FileStore.listSessions(cwd, tempDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('session-second');
    expect(sessions[1].sessionId).toBe('session-first');
  });

  it('clear should remove messages from disk', () => {
    const store = new FileStore('session-b', cwd, tempDir);
    store.add({ role: 'user', content: 'Before clear' });
    store.clear();

    const reloaded = new FileStore('session-b', cwd, tempDir);
    expect(reloaded.getAll()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行集成测试**

Run: `npx vitest run src/__tests__/persistence.integration.test.ts`
Expected: All tests PASS

- [ ] **Step 3: 运行全量测试套件**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/__tests__/persistence.integration.test.ts
git commit -m "test: add integration tests for session persistence"
```

---

## Final Verification

- [ ] **构建检查**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **手动冒烟测试**

```bash
# 启动时开启持久化
LOP_PERSISTENCE=true npm start

# 在会话中输入几条消息，然后退出

# 重新启动，使用 /sessions 查看已保存会话
LOP_PERSISTENCE=true npm start
# 在 TUI 中输入：/sessions
# 预期：看到上次的会话 ID、消息数、预览

# 使用 /load 恢复会话
# 在 TUI 中输入：/load <sessionId>
# 预期：显示 "Session loaded: <id> (N messages restored)"
```

---

## Implementation Notes

### 设计决策

1. **静态 import 代替 require()**：所有 storagePath 工具函数在 FileStore.ts 顶部静态导入，确保 ESM 兼容。

2. **sessionDir 参数用于测试隔离**：`FileStore(sessionId, cwd, sessionDir?)` 的第三个参数允许测试将文件写入 tempDir，而不污染 `~/.lop/`。

3. **clear() 截断文件**：`FileStore.clear()` 将文件内容清空（`writeFileSync(path, '')`），与 `InMemoryStore.clear()` 语义完全一致。若需保留历史，用户可在 clear 前使用 `/sessions` 记录 sessionId。

4. **replaceStore() 方法**：在 Agent 上暴露 `replaceStore()`，避免重建 Agent（重建会断开 MCP 连接）。/load 命令通过 `load_session` RPC 触发此方法。

5. **环境变量控制**：`LOP_PERSISTENCE=true` 开启持久化，默认关闭，不破坏现有行为。

### Error Handling

- 文件读取失败 / 不存在：`readLinesSync` 返回空数组，视为新会话
- `load_session` 找不到 session：服务器返回 -32001 错误，命令层显示错误消息
- JSONL 解析失败：`readLinesSync` 抛出带行号的错误信息，帮助定位损坏行

### Future Extensions

- 会话压缩（定期归档旧消息，保留最近 N 条）
- 分支对话（利用 parentUuid 构建树状历史）
- 云同步（将 JSONL 上传到远程存储）

# 文件持久化会话存储系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现基于 JSONL 文件的会话持久化系统，支持会话保存、加载和列表，保持与现有 InMemoryStore 接口兼容。

**Architecture:** 采用追加写入的 JSONL 文件格式存储会话记录，通过 `FileStore` 类实现 `MessageStore` 接口，提供即时持久化和会话恢复功能。会话按项目（工作目录哈希）隔离存储。

**Tech Stack:** TypeScript, Node.js fs API, UUID 生成

---

## File Structure

```
src/
├── server/
│   ├── store.ts                 # 现有 InMemoryStore + 新增 MessageStore 导出
│   ├── stores/
│   │   ├── FileStore.ts         # 文件持久化存储实现
│   │   └── types.ts             # 存储相关类型定义（SessionRecord 等）
│   └── utils/
│       ├── jsonl.ts             # JSONL 工具函数（readLinesSync, writeLineSync）
│       └── storagePath.ts       # 存储路径管理（getSessionDir, sanitizeCwd）
├── commands/
│   └── builtin/
│       ├── sessionsCommand.ts   # /sessions - 列出现有会话
│       ├── loadCommand.ts       # /load <sessionId> - 加载指定会话
│       └── index.ts             # 更新：导出新命令
├── protocol/types.ts            # 更新：添加会话持久化配置
└── config.ts                    # 更新：添加持久化配置支持
```

---

## Task 1: JSONL 工具模块

**Files:**
- Create: `src/server/utils/jsonl.ts`
- Test: `src/server/utils/jsonl.test.ts`

**Background:** JSONL (JSON Lines) 格式要求每行一个独立的 JSON 对象，使用换行符分隔。这允许我们追加写入而不需要读取和重写整个文件。

- [ ] **Step 1: Write failing test for writeLineSync**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeLineSync, readLinesSync } from './jsonl.js';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('jsonl', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jsonl-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should write a single record to file', () => {
    const filePath = join(tempDir, 'test.jsonl');
    const record = { id: 1, message: 'hello' };

    writeLineSync(filePath, record);

    const content = readFileSync(filePath, 'utf-8');
    expect(content.trim()).toBe(JSON.stringify(record));
  });

  it('should append multiple records to same file', () => {
    const filePath = join(tempDir, 'test.jsonl');
    const record1 = { id: 1, message: 'first' };
    const record2 = { id: 2, message: 'second' };

    writeLineSync(filePath, record1);
    writeLineSync(filePath, record2);

    const lines = readLinesSync(filePath);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(record1);
    expect(lines[1]).toEqual(record2);
  });

  it('should read empty file as empty array', () => {
    const filePath = join(tempDir, 'empty.jsonl');
    const lines = readLinesSync(filePath);
    expect(lines).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/server/utils/jsonl.test.ts -v`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Implement writeLineSync and readLinesSync**

```typescript
import { appendFileSync, existsSync, readFileSync } from 'fs';
import { dirname } from 'path';
import { mkdirSync } from 'fs';

/**
 * 同步追加一行 JSON 记录到文件
 * 自动创建父目录（如果不存在）
 */
export function writeLineSync<T>(filePath: string, record: T): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const line = JSON.stringify(record) + '\n';
  appendFileSync(filePath, line, 'utf-8');
}

/**
 * 同步读取 JSONL 文件，返回所有记录
 * 如果文件不存在，返回空数组
 * 自动过滤空行
 */
export function readLinesSync<T>(filePath: string): T[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const content = readFileSync(filePath, 'utf-8');
  return content
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest src/server/utils/jsonl.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/jsonl.ts src/server/utils/jsonl.test.ts
git commit -m "feat: add JSONL utilities for session persistence"
```

---

## Task 2: 存储路径管理

**Files:**
- Create: `src/server/utils/storagePath.ts`
- Test: `src/server/utils/storagePath.test.ts`

**Background:** 会话存储路径：`~/.lop/sessions/<project_hash>/<session_id>.jsonl`。`project_hash` 是工作目录的哈希值，用于项目隔离。

- [ ] **Step 1: Write failing test for storage path utils**

```typescript
import { describe, it, expect } from 'vitest';
import { getBaseDir, getSessionDir, sanitizeCwd, generateSessionId } from './storagePath.js';
import { homedir } from 'os';
import { join } from 'path';

describe('storagePath', () => {
  describe('getBaseDir', () => {
    it('should return .lop in home directory', () => {
      const baseDir = getBaseDir();
      expect(baseDir).toBe(join(homedir(), '.lop'));
    });
  });

  describe('sanitizeCwd', () => {
    it('should convert path to valid directory name', () => {
      const result = sanitizeCwd('/home/user/myproject');
      expect(result).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(result.length).toBeGreaterThan(0);
    });

    it('should produce same hash for same path', () => {
      const path = '/home/user/project';
      expect(sanitizeCwd(path)).toBe(sanitizeCwd(path));
    });

    it('should produce different hashes for different paths', () => {
      const path1 = '/home/user/project1';
      const path2 = '/home/user/project2';
      expect(sanitizeCwd(path1)).not.toBe(sanitizeCwd(path2));
    });
  });

  describe('getSessionDir', () => {
    it('should include project hash in path', () => {
      const cwd = '/home/user/myproject';
      const sessionDir = getSessionDir(cwd);
      expect(sessionDir).toContain('sessions');
      expect(sessionDir).toContain(sanitizeCwd(cwd));
    });
  });

  describe('generateSessionId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateSessionId();
      const id2 = generateSessionId();
      expect(id1).not.toBe(id2);
      expect(id1.length).toBeGreaterThanOrEqual(8);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/server/utils/storagePath.test.ts -v`
Expected: FAIL with module not found

- [ ] **Step 3: Implement storage path utilities**

```typescript
import { createHash } from 'crypto';
import { homedir } from 'os';
import { join } from 'path';

const BASE_DIR_NAME = '.lop';
const SESSIONS_DIR_NAME = 'sessions';

/**
 * 获取基础存储目录（~/.lop）
 */
export function getBaseDir(): string {
  return join(homedir(), BASE_DIR_NAME);
}

/**
 * 将工作目录路径转换为有效的目录名称（使用哈希）
 * 例如：/home/user/project -> a3f5c8...
 */
export function sanitizeCwd(cwd: string): string {
  return createHash('sha256')
    .update(cwd)
    .digest('hex')
    .slice(0, 16); // 取前16个字符，足够唯一且简洁
}

/**
 * 获取指定项目的会话存储目录
 */
export function getSessionDir(cwd: string): string {
  const projectHash = sanitizeCwd(cwd);
  return join(getBaseDir(), SESSIONS_DIR_NAME, projectHash);
}

/**
 * 获取会话文件的完整路径
 */
export function getSessionFilePath(cwd: string, sessionId: string): string {
  return join(getSessionDir(cwd), `${sessionId}.jsonl`);
}

/**
 * 生成唯一的会话 ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${random}`;
}

/**
 * 列出指定项目的所有会话文件
 */
export function listSessionFiles(cwd: string): string[] {
  const sessionDir = getSessionDir(cwd);
  if (!existsSync(sessionDir)) {
    return [];
  }
  return readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.slice(0, -6)); // 去掉 .jsonl 后缀
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest src/server/utils/storagePath.test.ts -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/utils/storagePath.ts src/server/utils/storagePath.test.ts
git commit -m "feat: add storage path utilities for session management"
```

---

## Task 3: FileStore 核心实现

**Files:**
- Create: `src/server/stores/types.ts`
- Create: `src/server/stores/FileStore.ts`
- Test: `src/server/stores/FileStore.test.ts`

- [ ] **Step 1: Write SessionRecord 类型定义**

Create `src/server/stores/types.ts`:

```typescript
import type { CoreMessage } from 'ai';

/**
 * 会话记录结构 - 存储在 JSONL 文件中
 */
export interface SessionRecord {
  /** 记录唯一标识符 */
  uuid: string;
  /** 父记录 UUID，根消息为 null */
  parentUuid: string | null;
  /** 会话 ID */
  sessionId: string;
  /** ISO 8601 时间戳 */
  timestamp: string;
  /** 记录类型 */
  type: 'user' | 'assistant' | 'tool_result';
  /** 工作目录 */
  cwd: string;
  /** 消息内容（CoreMessage 格式） */
  message: CoreMessage;
  /** 可选的元数据 */
  metadata?: {
    model?: string;
    tokenCount?: number;
  };
}

/**
 * 会话信息（用于列表展示）
 */
export interface SessionInfo {
  sessionId: string;
  /** 最后修改时间 */
  mtime: Date;
  /** 消息数量 */
  messageCount: number;
  /** 第一条消息的预览 */
  preview?: string;
}
```

- [ ] **Step 2: Write failing test for FileStore**

Create `src/server/stores/FileStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from './FileStore.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CoreMessage } from 'ai';

describe('FileStore', () => {
  let tempDir: string;
  let store: FileStore;
  const sessionId = 'test-session-123';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'filestore-test-'));
    store = new FileStore(sessionId, tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should add and retrieve user message', () => {
    const message: CoreMessage = { role: 'user', content: 'Hello' };
    store.add(message);

    const all = store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(message);
  });

  it('should add multiple messages', () => {
    store.add({ role: 'user', content: 'Hello' });
    store.add({ role: 'assistant', content: 'Hi there!' });

    const all = store.getAll();
    expect(all).toHaveLength(2);
  });

  it('should clear all messages', () => {
    store.add({ role: 'user', content: 'Hello' });
    store.clear();

    const all = store.getAll();
    expect(all).toHaveLength(0);
  });

  it('should persist messages to file', () => {
    store.add({ role: 'user', content: 'Persisted message' });

    // 创建新 store 实例读取同一文件
    const newStore = new FileStore(sessionId, tempDir);
    const all = newStore.getAll();

    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Persisted message');
  });

  it('should list sessions in directory', () => {
    store.add({ role: 'user', content: 'Test' });

    const sessions = FileStore.listSessions(tempDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe(sessionId);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest src/server/stores/FileStore.test.ts -v`
Expected: FAIL with "Cannot find module"

- [ ] **Step 4: Implement FileStore class**

Create `src/server/stores/FileStore.ts`:

```typescript
import type { CoreMessage } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, statSync } from 'fs';
import type { MessageStore } from '../store.js';
import { readLinesSync, writeLineSync } from '../utils/jsonl.js';
import type { SessionRecord, SessionInfo } from './types.js';

export class FileStore implements MessageStore {
  private records: SessionRecord[] = [];
  private filePath: string;
  private sessionId: string;
  private cwd: string;
  private lastUuid: string | null = null;

  constructor(
    sessionId: string,
    cwd: string,
    filePath?: string,
  ) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.filePath = filePath ?? this.getDefaultFilePath();
    this.loadFromDisk();
  }

  private getDefaultFilePath(): string {
    const { getSessionFilePath } = require('../utils/storagePath.js');
    return getSessionFilePath(this.cwd, this.sessionId);
  }

  /**
   * 从磁盘加载现有记录
   */
  private loadFromDisk(): void {
    this.records = readLinesSync<SessionRecord>(this.filePath);
    if (this.records.length > 0) {
      // 找到最后一条记录作为 parent
      const lastRecord = this.records[this.records.length - 1];
      this.lastUuid = lastRecord.uuid;
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

    // 追加到内存
    this.records.push(record);
    this.lastUuid = uuid;

    // 同步追加到磁盘
    writeLineSync(this.filePath, record);
  }

  getAll(): CoreMessage[] {
    return this.records.map(r => r.message);
  }

  clear(): void {
    this.records = [];
    this.lastUuid = null;
    // 注意：clear 不清除文件，只是清空内存
    // 下次实例化时会重新加载
  }

  /**
   * 获取会话 ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 获取消息数量
   */
  getMessageCount(): number {
    return this.records.length;
  }

  /**
   * 从 CoreMessage 推断记录类型
   */
  private inferType(message: CoreMessage): SessionRecord['type'] {
    switch (message.role) {
      case 'user':
        return 'user';
      case 'assistant':
        return 'assistant';
      case 'tool':
        return 'tool_result';
      default:
        return 'user';
    }
  }

  /**
   * 静态方法：列出指定目录的所有会话
   */
  static listSessions(cwd: string): SessionInfo[] {
    const { listSessionFiles, getSessionFilePath } = require('../utils/storagePath.js');
    const sessionIds = listSessionFiles(cwd);

    return sessionIds
      .map(id => {
        const filePath = getSessionFilePath(cwd, id);
        if (!existsSync(filePath)) {
          return null;
        }

        const stats = statSync(filePath);
        const records = readLinesSync<SessionRecord>(filePath);

        // 提取第一条用户消息作为预览
        const firstUserMsg = records.find(r => r.type === 'user');
        const preview = firstUserMsg
          ? String(firstUserMsg.message.content).slice(0, 50)
          : undefined;

        return {
          sessionId: id,
          mtime: stats.mtime,
          messageCount: records.length,
          preview,
        };
      })
      .filter((s): s is SessionInfo => s !== null)
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  /**
   * 静态方法：加载指定会话
   */
  static loadSession(sessionId: string, cwd: string): FileStore {
    return new FileStore(sessionId, cwd);
  }

  /**
   * 静态方法：创建新会话
   */
  static createSession(cwd: string): FileStore {
    const { generateSessionId } = require('../utils/storagePath.js');
    const sessionId = generateSessionId();
    return new FileStore(sessionId, cwd);
  }
}
```

- [ ] **Step 5: Update MessageStore interface to include optional methods**

Modify `src/server/store.ts`:

```typescript
import type { CoreMessage } from "ai"

export interface MessageStore {
  add(message: CoreMessage): void
  getAll(): CoreMessage[]
  clear(): void
}

export class InMemoryStore implements MessageStore {
  private messages: CoreMessage[] = []

  add(message: CoreMessage): void {
    this.messages.push(message)
  }

  getAll(): CoreMessage[] {
    return [...this.messages]
  }

  clear(): void {
    this.messages = []
  }
}

// 重新导出 FileStore
export { FileStore } from './stores/FileStore.js'
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest src/server/stores/FileStore.test.ts -v`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/server/stores/ src/server/store.ts
git commit -m "feat: implement FileStore for session persistence"
```

---

## Task 4: 配置持久化开关

**Files:**
- Modify: `src/protocol/types.ts:115-127`
- Modify: `src/config.ts:14-28`

- [ ] **Step 1: Add persistence config to LopConfig**

Modify `src/protocol/types.ts`:

```typescript
export interface LopConfig {
  provider?: Provider
  model?: string
  apiKey?: string
  baseURL?: string
  debug?: boolean
  // 兼容配置文件的命名
  token?: string
  url?: string
  // MCP 配置
  mcpServers?: Record<string, McpServerConfig>
  mcp?: { allowed?: string[]; excluded?: string[] }
  // 会话持久化配置
  persistence?: {
    enabled?: boolean
    baseDir?: string  // 可选：自定义存储目录
  }
}
```

- [ ] **Step 2: Update config loader to handle persistence**

Modify `src/config.ts` in the `normalizeConfig` function:

```typescript
/** 标准化配置（统一命名） */
function normalizeConfig(config: any): LopConfig {
  const parsed = parseMcpConfig(config)
  return {
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey ?? config.token,
    baseURL: config.baseURL ?? config.url,
    debug: config.debug ?? false,
    mcpServers: parsed.mcpServers,
    mcp: parsed.mcp,
    persistence: config.persistence,
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/protocol/types.ts src/config.ts
git commit -m "feat: add persistence configuration support"
```

---

## Task 5: Agent 集成 FileStore

**Files:**
- Modify: `src/server/agent.ts`

- [ ] **Step 1: Modify agent to use FileStore when persistence enabled**

Read the current `src/server/agent.ts` to understand the structure, then modify it to support FileStore:

```typescript
// 在文件顶部导入
import { FileStore } from './stores/FileStore.js';
import { generateSessionId, getSessionFilePath } from './utils/storagePath.js';

// 在 Agent 构造函数中
constructor(private config: AgentConfig) {
  // ... existing code ...

  // 根据配置选择存储实现
  if (config.persistence?.enabled) {
    const sessionId = config.sessionId ?? generateSessionId();
    this.store = FileStore.createSession(config.cwd ?? process.cwd());
    this.sessionId = this.store.getSessionId();
  } else {
    this.store = new InMemoryStore();
  }
}

// 修改接口定义
type AgentConfig = {
  llm: LLMClient;
  tools: ToolRegistry;
  hooks?: Hooks;
  persistence?: { enabled?: boolean };
  sessionId?: string;  // 可选：指定会话 ID 以恢复会话
  cwd?: string;
};
```

- [ ] **Step 2: Test agent with FileStore**

Run: `npm run build && npm run start -- --persistence`
Expected: No TypeScript errors, can start normally

- [ ] **Step 3: Commit**

```bash
git add src/server/agent.ts
git commit -m "feat: integrate FileStore into Agent"
```

---

## Task 6: /sessions 命令

**Files:**
- Create: `src/commands/builtin/sessionsCommand.ts`
- Modify: `src/commands/builtin/index.ts`

- [ ] **Step 1: Implement /sessions command**

Create `src/commands/builtin/sessionsCommand.ts`:

```typescript
import type { Command } from '../types.js';
import { FileStore } from '../../server/stores/FileStore.js';
import { getSessionDir } from '../../server/utils/storagePath.js';

export const sessionsCommand: Command = {
  name: 'sessions',
  aliases: ['list'],
  description: 'List all saved sessions for current project',

  async execute(args, { client, setOutput }) {
    const cwd = process.cwd();
    const sessions = FileStore.listSessions(cwd);

    if (sessions.length === 0) {
      setOutput('No saved sessions found. Start chatting to create one!');
      return;
    }

    const lines = [
      `Found ${sessions.length} session(s):`,
      '',
      ...sessions.map((s, i) => {
        const date = s.mtime.toLocaleString('zh-CN');
        const preview = s.preview ? ` - "${s.preview}"` : '';
        return `${i + 1}. ${s.sessionId} (${s.messageCount} msgs, ${date})${preview}`;
      }),
      '',
      'Use /load <sessionId> to resume a session.',
    ];

    setOutput(lines.join('\n'));
  },
};
```

- [ ] **Step 2: Export the command**

Modify `src/commands/builtin/index.ts`:

```typescript
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { mcpCommand } from './mcpCommand.js'
export { themeCommand } from './themeCommand.js'
export { sessionsCommand } from './sessionsCommand.js'  // Add this line
```

- [ ] **Step 3: Register the command**

Modify `src/commands/loaders/BuiltinCommandLoader.ts` (if exists) or the file that registers built-in commands to include `sessionsCommand`.

- [ ] **Step 4: Commit**

```bash
git add src/commands/builtin/sessionsCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add /sessions command to list saved sessions"
```

---

## Task 7: /load 命令

**Files:**
- Create: `src/commands/builtin/loadCommand.ts`
- Modify: `src/commands/builtin/index.ts`

- [ ] **Step 1: Implement /load command**

Create `src/commands/builtin/loadCommand.ts`:

```typescript
import type { Command } from '../types.js';
import { FileStore } from '../../server/stores/FileStore.js';

export const loadCommand: Command = {
  name: 'load',
  aliases: ['resume'],
  description: 'Load a previous session by ID',

  async execute(args, { client, setOutput, exit }) {
    const sessionId = args[0];

    if (!sessionId) {
      setOutput('Usage: /load <sessionId>\nUse /sessions to list available sessions.');
      return;
    }

    try {
      const cwd = process.cwd();
      const store = FileStore.loadSession(sessionId, cwd);

      if (store.getMessageCount() === 0) {
        setOutput(`Session ${sessionId} not found or is empty.`);
        return;
      }

      // 发送加载会话的请求到服务器
      // 这里需要与客户端协议集成
      client.loadSession?.(sessionId);

      setOutput(`Loading session ${sessionId}...`);

      // 可选：退出当前 TUI 并重新启动以加载新会话
      // 或者通过某种机制切换到新会话
      exit?.();
    } catch (error) {
      setOutput(`Failed to load session: ${error}`);
    }
  },
};
```

- [ ] **Step 2: Export and register the command**

Modify `src/commands/builtin/index.ts`:

```typescript
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { mcpCommand } from './mcpCommand.js'
export { themeCommand } from './themeCommand.js'
export { sessionsCommand } from './sessionsCommand.js'
export { loadCommand } from './loadCommand.js'  // Add this line
```

- [ ] **Step 3: Commit**

```bash
git add src/commands/builtin/loadCommand.ts src/commands/builtin/index.ts
git commit -m "feat: add /load command to resume sessions"
```

---

## Task 8: 客户端-服务器协议扩展

**Files:**
- Modify: `src/protocol/types.ts`
- Modify: `src/client/index.ts` (或相关客户端文件)

**Background:** 需要扩展 JSON-RPC 协议以支持会话加载。

- [ ] **Step 1: Add loadSession method to protocol**

Modify `src/protocol/types.ts`:

```typescript
// 添加 loadSession 参数
export const LoadSessionParamsSchema = z.object({
  sessionId: z.string(),
  cwd: z.string().optional(),
});

export type LoadSessionParams = z.infer<typeof LoadSessionParamsSchema>;

// 添加新的通知类型
export interface SessionLoadedNotification extends JsonRpcNotification {
  method: "session_loaded";
  params: {
    sessionId: string;
    messageCount: number;
  };
}
```

- [ ] **Step 2: Implement client-side loadSession**

根据现有客户端架构，添加 `loadSession` 方法到客户端类中。

- [ ] **Step 3: Implement server-side loadSession handler**

在服务器端添加处理 `loadSession` 请求的逻辑，重新初始化 Agent 的 store。

- [ ] **Step 4: Commit**

```bash
git add src/protocol/types.ts src/client/ src/server/
git commit -m "feat: extend protocol to support session loading"
```

---

## Task 9: 集成测试

**Files:**
- Create: `src/__tests__/persistence.integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../server/stores/FileStore.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { CoreMessage } from 'ai';

describe('Persistence Integration', () => {
  let tempDir: string;
  const cwd = '/test/project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'persistence-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should persist and restore full conversation', () => {
    // 创建会话并添加消息
    const store1 = FileStore.createSession(cwd);
    const sessionId = store1.getSessionId();

    store1.add({ role: 'user', content: 'Hello AI' });
    store1.add({ role: 'assistant', content: 'Hello! How can I help?' });
    store1.add({ role: 'user', content: 'What is the weather?' });

    // 创建新的 store 实例读取同一会话
    const store2 = FileStore.loadSession(sessionId, cwd);
    const messages = store2.getAll();

    expect(messages).toHaveLength(3);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toBe('Hello AI');
    expect(messages[1].role).toBe('assistant');
    expect(messages[2].role).toBe('user');
  });

  it('should list sessions ordered by modification time', () => {
    const store1 = FileStore.createSession(cwd);
    store1.add({ role: 'user', content: 'First session' });

    // 短暂等待确保时间戳不同
    const store2 = FileStore.createSession(cwd);
    store2.add({ role: 'user', content: 'Second session' });

    const sessions = FileStore.listSessions(cwd);

    expect(sessions).toHaveLength(2);
    // 最新的会话应该排在前面
    expect(sessions[0].sessionId).toBe(store2.getSessionId());
    expect(sessions[1].sessionId).toBe(store1.getSessionId());
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npx vitest src/__tests__/persistence.integration.test.ts -v`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/persistence.integration.test.ts
git commit -m "test: add integration tests for session persistence"
```

---

## Task 10: 文档更新

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md with persistence info**

Add new section to CLAUDE.md:

```markdown
## Session Persistence

lop_minimal 支持文件持久化存储会话历史。

### 配置

在配置文件中启用：

```json
{
  "persistence": {
    "enabled": true,
    "baseDir": "~/.lop/sessions"  // 可选，自定义存储目录
  }
}
```

### 存储格式

- 格式：JSON Lines (JSONL)
- 位置：`~/.lop/sessions/<project_hash>/<session_id>.jsonl`
- 项目隔离：基于工作目录哈希

### 命令

- `/sessions` - 列出现有会话
- `/load <sessionId>` - 加载指定会话

### API

```typescript
// 创建新会话
const store = FileStore.createSession(cwd);

// 加载现有会话
const store = FileStore.loadSession(sessionId, cwd);

// 列出现有会话
const sessions = FileStore.listSessions(cwd);
```
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add session persistence documentation"
```

---

## Final Verification

- [ ] **Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Build check**

Run: `npm run build`
Expected: No TypeScript errors

- [ ] **Manual test**

1. Start lop_minimal with persistence enabled
2. Send a few messages
3. Exit and restart
4. Verify session was saved and can be listed with `/sessions`
5. Load the session with `/load <id>`
6. Verify conversation history is restored

---

## Implementation Notes

### Design Decisions

1. **追加写入 vs 全量写入**：选择追加写入 JSONL 是为了保证崩溃安全和性能，避免每次消息都重写整个文件。

2. **同步 vs 异步**：使用同步文件操作（`writeLineSync`）确保消息立即持久化，防止进程崩溃导致数据丢失。

3. **UUID 关联**：`uuid` 和 `parentUuid` 字段为未来分支功能预留，当前只使用线性历史。

4. **项目隔离**：通过工作目录 SHA256 哈希实现项目隔离，避免不同项目的会话混淆。

### Error Handling

- 文件读取失败：返回空数组（视为新会话）
- 写入失败：抛出异常，上层处理
- 无效的会话 ID：返回空 store

### Future Extensions

- 会话压缩（定期清理旧消息）
- 分支对话（利用 parentUuid 构建树）
- 云同步（将 JSONL 上传到远程存储）
- 导入/导出（支持与其他工具交换会话）

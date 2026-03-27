import type { CoreMessage } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MessageStore } from '../store.js';
import { readLinesSync, writeLineSync } from '../utils/jsonl.js';
import { generateSessionId, getSessionDir, listSessionIds } from '../utils/storagePath.js';
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
    return this.records.filter(r => r.type !== 'meta').map(r => r.message!);
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
    return this.records.filter(r => r.type !== 'meta').length;
  }

  private inferType(message: CoreMessage): SessionRecord['type'] {
    if (message.role === 'assistant') return 'assistant';
    if (message.role === 'tool') return 'tool_result';
    return 'user';
  }

  /** Write a metadata record (provider/model) at the start of the session file. */
  setMeta(provider: string, model: string): void {
    const record: SessionRecord = {
      uuid: randomUUID(),
      parentUuid: null,
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      type: 'meta',
      cwd: this.cwd,
      message: null,
      meta: { provider, model },
    };
    this.records.unshift(record);
    writeFileSync(this.filePath, '');
    for (const r of this.records) {
      writeLineSync(this.filePath, r);
    }
  }

  /** 列出指定目录的所有会话，按最后修改时间倒序 */
  static listSessions(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? getSessionDir(cwd);
    const results: SessionInfo[] = [];
    for (const id of listSessionIds(dir)) {
      const filePath = join(dir, `${id}.jsonl`);
      let stats: ReturnType<typeof statSync>;
      let records: SessionRecord[];
      try {
        stats = statSync(filePath);
        records = readLinesSync<SessionRecord>(filePath);
      } catch {
        continue;
      }
      const metaRecord = records.find(r => r.type === 'meta');
      const userRecords = records.filter(r => r.type === 'user');
      const firstUser = userRecords[0];
      const preview = firstUser ? String(firstUser.message!.content).slice(0, 60) : undefined;
      results.push({
        sessionId: id,
        mtime: stats.mtime,
        messageCount: userRecords.length,
        preview,
        startTime: records[0]?.timestamp,
        model: metaRecord?.meta?.model,
        provider: metaRecord?.meta?.provider,
      });
    }
    return results.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  }

  /** 加载已有会话（从默认路径） */
  static loadSession(sessionId: string, cwd: string): FileStore {
    return new FileStore(sessionId, cwd);
  }

  /** 创建新会话（从默认路径） */
  static createSession(cwd: string): FileStore {
    return new FileStore(generateSessionId(), cwd);
  }

  /** Delete a session's JSONL file. Returns true if file existed. */
  static deleteSession(sessionId: string, cwd: string, sessionDir?: string): boolean {
    const dir = sessionDir ?? getSessionDir(cwd);
    const filePath = join(dir, `${sessionId}.jsonl`);
    try {
      unlinkSync(filePath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }
}

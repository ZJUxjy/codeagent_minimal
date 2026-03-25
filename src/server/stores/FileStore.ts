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

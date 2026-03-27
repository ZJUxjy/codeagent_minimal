import type { CoreMessage } from 'ai';
import { randomUUID } from 'crypto';
import { existsSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { MessageStore } from '../store.js';
import { readLinesSync, writeLineSync } from '../utils/jsonl.js';
import { generateSessionId, getSessionDir, listSessionIds } from '../utils/storagePath.js';
import type { SessionInfo, SessionRecord, SessionMeta } from './types.js';
import { SessionIndex } from './SessionIndex.js';

const MAX_PREVIEW_LENGTH = 60;

/** CoreMessage.content can be a string or structured array; extract as plain text. */
function contentToPreview(content: CoreMessage['content']): string {
  return typeof content === 'string' ? content : JSON.stringify(content);
}

function metaToInfo(m: SessionMeta): SessionInfo {
  return {
    sessionId: m.sessionId,
    mtime: new Date(m.updatedAt),
    messageCount: m.messageCount,
    preview: m.preview ?? undefined,
    title: m.title ?? undefined,
    startTime: m.createdAt,
    model: m.model ?? undefined,
    provider: m.provider ?? undefined,
  };
}

export class FileStore implements MessageStore {
  private records: SessionRecord[] = [];
  private filePath: string;
  private sessionId: string;
  private cwd: string;
  private lastUuid: string | null = null;
  private sessionDir: string;

  /**
   * @param sessionId  会话唯一标识
   * @param cwd        工作目录（用于生成默认存储路径）
   * @param sessionDir 可选：自定义会话目录（测试隔离用）
   */
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

    const index = new SessionIndex(this.sessionDir);
    const existing = index.getSession(this.sessionId);
    const messageCount = this.getMessageCount();
    const preview = message.role === 'user'
      ? contentToPreview(message.content).slice(0, MAX_PREVIEW_LENGTH)
      : null;

    if (existing) {
      const updates: Partial<SessionMeta> = { messageCount, updatedAt: record.timestamp };
      if (!existing.preview && preview) updates.preview = preview;
      index.updateSession(this.sessionId, updates);
    } else {
      index.addSession({
        sessionId: this.sessionId,
        title: null,
        messageCount,
        createdAt: record.timestamp,
        updatedAt: record.timestamp,
        preview,
      });
    }
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
    const index = new SessionIndex(this.sessionDir);
    index.updateSession(this.sessionId, { messageCount: 0, updatedAt: new Date().toISOString() });
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
    const timestamp = new Date().toISOString();
    const record: SessionRecord = {
      uuid: randomUUID(),
      parentUuid: null,
      sessionId: this.sessionId,
      timestamp,
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

    const index = new SessionIndex(this.sessionDir);
    const existing = index.getSession(this.sessionId);
    if (existing) {
      index.updateSession(this.sessionId, { model, provider });
    } else {
      index.addSession({
        sessionId: this.sessionId,
        title: null,
        messageCount: this.getMessageCount(),
        createdAt: timestamp,
        updatedAt: timestamp,
        preview: null,
        model,
        provider,
      });
    }
  }

  /** 列出所有会话，优先读 SessionIndex（O(1)），回退时扫描 JSONL 重建索引 */
  static listSessions(cwd: string, sessionDir?: string): SessionInfo[] {
    const dir = sessionDir ?? getSessionDir(cwd);
    const index = new SessionIndex(dir);
    const sessions = index.listSessions();

    if (sessions.length > 0) {
      return sessions.map(metaToInfo);
    }

    // Rebuild index from JSONL files (backward compatibility / first run)
    const ids = listSessionIds(dir);
    if (ids.length === 0) return [];

    const metas: SessionMeta[] = [];
    for (const id of ids) {
      const filePath = join(dir, `${id}.jsonl`);
      let stats: ReturnType<typeof statSync>;
      let records: SessionRecord[];
      try {
        stats = statSync(filePath);
        records = readLinesSync<SessionRecord>(filePath);
      } catch {
        continue;
      }
      if (records.length === 0) continue;
      const metaRecord = records.find(r => r.type === 'meta');
      const firstUser = records.find(r => r.type === 'user');
      const preview = firstUser
        ? contentToPreview(firstUser.message!.content).slice(0, MAX_PREVIEW_LENGTH)
        : null;
      metas.push({
        sessionId: id,
        title: null,
        messageCount: records.filter(r => r.type !== 'meta').length,
        createdAt: records[0].timestamp,
        updatedAt: stats.mtime.toISOString(),
        preview,
        model: metaRecord?.meta?.model ?? null,
        provider: metaRecord?.meta?.provider ?? null,
      });
    }

    if (metas.length === 0) return [];
    index.bulkAddSessions(metas);
    return metas
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(metaToInfo);
  }

  /** 加载已有会话（从默认路径） */
  static loadSession(sessionId: string, cwd: string): FileStore {
    return new FileStore(sessionId, cwd);
  }

  /** 创建新会话（从默认路径） */
  static createSession(cwd: string): FileStore {
    return new FileStore(generateSessionId(), cwd);
  }

  /** Delete a session's JSONL file and remove from index. Returns true if existed. */
  static deleteSession(sessionId: string, cwd: string, sessionDir?: string): boolean {
    const dir = sessionDir ?? getSessionDir(cwd);
    const filePath = join(dir, `${sessionId}.jsonl`);
    try {
      unlinkSync(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
    new SessionIndex(dir).removeSession(sessionId);
    return true;
  }
}

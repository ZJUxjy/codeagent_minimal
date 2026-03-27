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
  private dirCreated = false

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
    if (!this.dirCreated) {
      mkdirSync(this.dir, { recursive: true })
      this.dirCreated = true
    }
    const data: IndexData = {
      sessions: Object.fromEntries(this.entries),
    }
    writeFileSync(this.indexPath, JSON.stringify(data, null, 2), 'utf-8')
  }

  addSession(meta: SessionMeta): void {
    this.entries.set(meta.sessionId, meta)
    this.save()
  }

  bulkAddSessions(metas: SessionMeta[]): void {
    for (const meta of metas) {
      this.entries.set(meta.sessionId, meta)
    }
    if (metas.length > 0) this.save()
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

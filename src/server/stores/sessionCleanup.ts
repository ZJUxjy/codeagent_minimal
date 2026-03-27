import { FileStore } from './FileStore.js'

export function cleanupOldSessions(
  cwd: string,
  opts?: { maxAgeMs?: number; maxCount?: number },
  sessionDir?: string,
): number {
  const maxAgeMs = opts?.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000  // 30 days
  const maxCount = opts?.maxCount ?? 50

  // listSessions already sorted by mtime descending (newest first)
  const sessions = FileStore.listSessions(cwd, sessionDir)
  const cutoff = Date.now() - maxAgeMs
  let deleted = 0

  for (let i = 0; i < sessions.length; i++) {
    if (i >= maxCount || sessions[i].mtime.getTime() < cutoff) {
      FileStore.deleteSession(sessions[i].sessionId, cwd, sessionDir)
      deleted++
    }
  }

  return deleted
}

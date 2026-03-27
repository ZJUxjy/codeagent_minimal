import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { cleanupOldSessions } from '../sessionCleanup.js'
import { FileStore } from '../FileStore.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('sessionCleanup', () => {
  let tempDir: string
  const cwd = '/test/project'

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'cleanup-')) })
  afterEach(() => { rmSync(tempDir, { recursive: true }) })

  it('should keep only maxCount newest sessions', () => {
    new FileStore('old-1', cwd, tempDir).add({ role: 'user', content: 'a' })
    new FileStore('old-2', cwd, tempDir).add({ role: 'user', content: 'b' })
    new FileStore('old-3', cwd, tempDir).add({ role: 'user', content: 'c' })

    const deleted = cleanupOldSessions(cwd, { maxCount: 1 }, tempDir)
    expect(deleted).toBe(2)

    const remaining = FileStore.listSessions(cwd, tempDir)
    expect(remaining).toHaveLength(1)
  })

  it('should not delete if under maxCount', () => {
    new FileStore('keep-1', cwd, tempDir).add({ role: 'user', content: 'a' })
    new FileStore('keep-2', cwd, tempDir).add({ role: 'user', content: 'b' })

    const deleted = cleanupOldSessions(cwd, { maxCount: 10 }, tempDir)
    expect(deleted).toBe(0)

    const remaining = FileStore.listSessions(cwd, tempDir)
    expect(remaining).toHaveLength(2)
  })

  it('should delete sessions older than maxAgeMs', () => {
    const store = new FileStore('ancient', cwd, tempDir)
    store.add({ role: 'user', content: 'old' })

    const deleted = cleanupOldSessions(cwd, { maxAgeMs: 0 }, tempDir)
    expect(deleted).toBe(1)

    const remaining = FileStore.listSessions(cwd, tempDir)
    expect(remaining).toHaveLength(0)
  })
})

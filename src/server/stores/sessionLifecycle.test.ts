import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStore } from './FileStore.js'
import { SessionIndex } from './SessionIndex.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Session Lifecycle Integration', () => {
  let tempDir: string
  const cwd = '/test/lifecycle/project'

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lifecycle-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true })
  })

  it('full lifecycle: create → add → list → rename → delete', () => {
    // Create a session and add messages
    const store = new FileStore('lifecycle-sess', cwd, tempDir)
    store.add({ role: 'user', content: 'Hello from lifecycle test' })
    store.add({ role: 'assistant', content: 'Hi there!' })

    // List sessions — should find the one we created
    const sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].sessionId).toBe('lifecycle-sess')
    expect(sessions[0].messageCount).toBe(2)
    expect(sessions[0].preview).toBe('Hello from lifecycle test')

    // Rename (set title) via SessionIndex
    const index = new SessionIndex(tempDir)
    index.updateSession('lifecycle-sess', { title: 'My Renamed Session' })
    const meta = index.getSession('lifecycle-sess')
    expect(meta?.title).toBe('My Renamed Session')

    // Delete the session
    const deleted = FileStore.deleteSession('lifecycle-sess', cwd, tempDir)
    expect(deleted).toBe(true)

    // List should now be empty
    const afterDelete = FileStore.listSessions(cwd, tempDir)
    expect(afterDelete).toHaveLength(0)
  })

  it('multiple sessions with different update times sort correctly', async () => {
    // Create first session
    const store1 = new FileStore('sess-older', cwd, tempDir)
    store1.add({ role: 'user', content: 'I am the older session' })

    // Small delay to ensure different updatedAt timestamps
    await new Promise(r => setTimeout(r, 50))

    // Create second session (newer)
    const store2 = new FileStore('sess-newer', cwd, tempDir)
    store2.add({ role: 'user', content: 'I am the newer session' })

    // List should return newest first
    const sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(2)
    expect(sessions[0].sessionId).toBe('sess-newer')
    expect(sessions[1].sessionId).toBe('sess-older')

    // Now update the older session — it should move to the top
    await new Promise(r => setTimeout(r, 50))
    store1.add({ role: 'user', content: 'Adding another message to older session' })

    const sessionsAfterUpdate = FileStore.listSessions(cwd, tempDir)
    expect(sessionsAfterUpdate).toHaveLength(2)
    expect(sessionsAfterUpdate[0].sessionId).toBe('sess-older')
    expect(sessionsAfterUpdate[1].sessionId).toBe('sess-newer')
  })
})

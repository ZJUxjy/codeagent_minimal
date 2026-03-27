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

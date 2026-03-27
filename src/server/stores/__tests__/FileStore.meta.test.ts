import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStore } from '../FileStore.js'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('FileStore metadata', () => {
  let tempDir: string
  const cwd = '/test/project'

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'meta-test-')) })
  afterEach(() => { rmSync(tempDir, { recursive: true }) })

  it('should store and retrieve model/provider metadata', () => {
    const store = new FileStore('meta-session', cwd, tempDir)
    store.setMeta('openai', 'gpt-4o')
    store.add({ role: 'user', content: 'hello' })

    const sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].model).toBe('gpt-4o')
    expect(sessions[0].provider).toBe('openai')
  })

  it('should extract startTime from first record', () => {
    const store = new FileStore('time-session', cwd, tempDir)
    store.add({ role: 'user', content: 'hello' })

    const sessions = FileStore.listSessions(cwd, tempDir)
    expect(sessions[0].startTime).toBeDefined()
  })

  it('getAll should filter out meta records', () => {
    const store = new FileStore('filter-session', cwd, tempDir)
    store.setMeta('openai', 'gpt-4o')
    store.add({ role: 'user', content: 'hello' })
    store.add({ role: 'assistant', content: 'hi there' })

    const messages = store.getAll()
    expect(messages).toHaveLength(2)  // not 3
  })

  it('getMessageCount should exclude meta records', () => {
    const store = new FileStore('count-session', cwd, tempDir)
    store.setMeta('anthropic', 'claude-3')
    store.add({ role: 'user', content: 'hello' })
    store.add({ role: 'user', content: 'world' })

    expect(store.getMessageCount()).toBe(2)
  })
})

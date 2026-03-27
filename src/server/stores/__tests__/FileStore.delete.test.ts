import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileStore } from '../FileStore.js'
import { existsSync } from 'fs'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('FileStore.deleteSession', () => {
  let tempDir: string
  const cwd = '/test/project'

  beforeEach(() => { tempDir = mkdtempSync(join(tmpdir(), 'del-test-')) })
  afterEach(() => { rmSync(tempDir, { recursive: true }) })

  it('should delete an existing session file', () => {
    const store = new FileStore('to-delete', cwd, tempDir)
    store.add({ role: 'user', content: 'hello' })
    const filePath = join(tempDir, 'to-delete.jsonl')
    expect(existsSync(filePath)).toBe(true)

    const result = FileStore.deleteSession('to-delete', cwd, tempDir)
    expect(result).toBe(true)
    expect(existsSync(filePath)).toBe(false)
  })

  it('should return false for non-existent session', () => {
    const result = FileStore.deleteSession('ghost', cwd, tempDir)
    expect(result).toBe(false)
  })
})

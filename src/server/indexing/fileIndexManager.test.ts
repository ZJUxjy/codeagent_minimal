import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndexManager } from './fileIndexManager.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('FileIndexManager', () => {
    let testDir: string

    beforeEach(() => {
        testDir = join(tmpdir(), `trigram-test-${Date.now()}`)
        mkdirSync(testDir, { recursive: true })
        mkdirSync(join(testDir, 'src'), { recursive: true })
        writeFileSync(join(testDir, 'src', 'hello.ts'), 'export function hello() { return "world" }')
        writeFileSync(join(testDir, 'src', 'foo.ts'), 'export const foo = "bar"')
        writeFileSync(join(testDir, 'README.md'), '# Hello World')
    })

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true })
    })

    it('should build index from directory', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        expect(manager.indexedFileCount).toBeGreaterThanOrEqual(3)
    })

    it('should find candidates for a known string', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        const candidates = manager.search('hello')!
        expect(candidates.some(f => f.endsWith('hello.ts'))).toBe(true)
    })

    it('should not return unrelated files', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()
        const candidates = manager.search('hello')!
        expect(candidates.some(f => f.endsWith('foo.ts'))).toBe(false)
    })

    it('should update index when notified of file change', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        // "uniquetoken" initially absent (trigrams extractable, but no file matches)
        expect(manager.search('uniquetoken')!.length).toBe(0)

        // Notify of file change
        manager.onFileChanged(join(testDir, 'src', 'hello.ts'), 'export const uniquetoken = 1')
        expect(manager.search('uniquetoken')!.some(f => f.endsWith('hello.ts'))).toBe(true)
    })

    it('should skip node_modules and .git directories', async () => {
        mkdirSync(join(testDir, 'node_modules', 'pkg'), { recursive: true })
        writeFileSync(join(testDir, 'node_modules', 'pkg', 'index.js'), 'special_marker_nm')
        mkdirSync(join(testDir, '.git', 'objects'), { recursive: true })
        writeFileSync(join(testDir, '.git', 'objects', 'abc'), 'special_marker_git')

        const manager = new FileIndexManager(testDir)
        await manager.build()
        // Files are in ignored dirs, so not indexed → empty result (trigrams are extractable)
        expect(manager.search('special_marker_nm')!.length).toBe(0)
        expect(manager.search('special_marker_git')!.length).toBe(0)
    })

    it('should skip binary-like files', async () => {
        writeFileSync(join(testDir, 'image.png'), 'should_not_index_png')
        const manager = new FileIndexManager(testDir)
        await manager.build()
        // "should_not_index_png" is long enough for trigrams, but file is in ignored extensions
        // The file won't be indexed, so query returns empty array (not null, since trigrams are extractable)
        expect(manager.search('should_not_index_png')!.length).toBe(0)
    })

    it('should report isReady after build', async () => {
        const manager = new FileIndexManager(testDir)
        expect(manager.isReady).toBe(false)
        await manager.build()
        expect(manager.isReady).toBe(true)
    })
})

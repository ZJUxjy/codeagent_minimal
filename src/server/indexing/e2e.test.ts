import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FileIndexManager } from './fileIndexManager.js'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('Trigram Index E2E', () => {
    let testDir: string

    beforeEach(() => {
        testDir = join(tmpdir(), `trigram-e2e-${Date.now()}`)
        mkdirSync(join(testDir, 'src', 'utils'), { recursive: true })
        mkdirSync(join(testDir, 'src', 'components'), { recursive: true })

        writeFileSync(join(testDir, 'src', 'utils', 'auth.ts'),
            'export function authenticateUser(token: string) {\n  return validateToken(token)\n}')
        writeFileSync(join(testDir, 'src', 'utils', 'db.ts'),
            'export function connectDatabase(url: string) {\n  return new Pool({ connectionString: url })\n}')
        writeFileSync(join(testDir, 'src', 'components', 'Login.tsx'),
            'export function Login() {\n  return <form onSubmit={handleLogin}>\n    <input />\n  </form>\n}')
        writeFileSync(join(testDir, 'src', 'components', 'Dashboard.tsx'),
            'export function Dashboard() {\n  return <div>Welcome</div>\n}')

        // 50 filler files to simulate a larger project
        for (let i = 0; i < 50; i++) {
            writeFileSync(join(testDir, 'src', `filler_${i}.ts`),
                `export const filler${i} = ${i}\nconst padding = "some generic content ${i}"\n`)
        }
    })

    afterEach(() => {
        rmSync(testDir, { recursive: true, force: true })
    })

    it('should narrow candidates for specific function name', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        const candidates = manager.search('authenticateUser')
        expect(candidates.length).toBeLessThan(10)
        expect(candidates.some(f => f.includes('auth.ts'))).toBe(true)
        expect(candidates.some(f => f.includes('Dashboard.tsx'))).toBe(false)
    })

    it('should narrow candidates for regex pattern', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        const candidates = manager.search('connectDatabase')
        expect(candidates.some(f => f.includes('db.ts'))).toBe(true)
        expect(candidates.length).toBeLessThan(5)
    })

    it('should return all files for pure wildcard (graceful degradation)', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        // ".*" can't yield trigrams → returns all files
        const candidates = manager.search('.*')
        expect(candidates.length).toBe(manager.indexedFileCount)
    })

    it('should reflect incremental updates', async () => {
        const manager = new FileIndexManager(testDir)
        await manager.build()

        const newFile = join(testDir, 'src', 'newFeature.ts')
        writeFileSync(newFile, 'export function superSpecialFeature() {}')
        manager.onFileChanged(newFile, 'export function superSpecialFeature() {}')

        const candidates = manager.search('superSpecialFeature')
        expect(candidates.some(f => f.includes('newFeature.ts'))).toBe(true)
    })
})

import { describe, it, expect } from 'vitest'
import { TrigramIndex, extractTrigrams } from './trigram.js'

describe('extractTrigrams', () => {
    it('should extract overlapping 3-char sequences', () => {
        const result = extractTrigrams('hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should return empty set for strings shorter than 3', () => {
        expect(extractTrigrams('ab')).toEqual(new Set())
        expect(extractTrigrams('')).toEqual(new Set())
    })

    it('should handle single trigram', () => {
        expect(extractTrigrams('abc')).toEqual(new Set(['abc']))
    })

    it('should lowercase trigrams for case-insensitive matching', () => {
        const result = extractTrigrams('Hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })
})

describe('TrigramIndex', () => {
    it('should add file and retrieve candidates', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).toContain('a.ts')
    })

    it('should return intersection of trigram posting lists', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        index.addFile('b.ts', 'const world = 1')
        // "hello" trigrams won't match b.ts
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).toContain('a.ts')
        expect(candidates).not.toContain('b.ts')
    })

    it('should handle removeFile', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'function hello() {}')
        index.removeFile('a.ts')
        const candidates = index.query(extractTrigrams('hello'))
        expect(candidates).not.toContain('a.ts')
    })

    it('should handle updateFile (remove old trigrams, add new)', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'hello world')
        index.updateFile('a.ts', 'goodbye world')
        expect(index.query(extractTrigrams('hello'))).not.toContain('a.ts')
        expect(index.query(extractTrigrams('goodbye'))).toContain('a.ts')
    })

    it('should return all files when query trigrams is empty', () => {
        const index = new TrigramIndex()
        index.addFile('a.ts', 'hello')
        index.addFile('b.ts', 'world')
        const candidates = index.query(new Set())
        expect(candidates.length).toBe(2)
    })

    it('should report file count via size getter', () => {
        const index = new TrigramIndex()
        expect(index.size).toBe(0)
        index.addFile('a.ts', 'hello')
        expect(index.size).toBe(1)
    })
})

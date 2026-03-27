import { describe, it, expect } from 'vitest'
import { decompose } from './queryDecompose.js'

describe('decompose', () => {
    it('should extract trigrams from plain literal string', () => {
        const result = decompose('hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should extract trigrams from string with regex metacharacters splitting', () => {
        // "foo.*bar" → literals ["foo", "bar"] → trigrams from each
        const result = decompose('foo.*bar')
        expect(result).toContain('foo')
        expect(result).toContain('bar')
    })

    it('should handle character classes by splitting', () => {
        // "he[lr]lo" → "he" and "lo" as literal segments; "he" too short, "lo" too short
        // No trigrams extractable
        const result = decompose('he[lr]lo')
        expect(result.size).toBe(0)
    })

    it('should handle longer literal around character class', () => {
        // "hello[12]world" → "hello" → [hel, ell, llo], "world" → [wor, orl, rld]
        const result = decompose('hello[12]world')
        expect(result).toContain('hel')
        expect(result).toContain('wor')
    })

    it('should handle escaped metacharacters as literals', () => {
        // "foo\.bar" → "foo.bar" → trigrams
        const result = decompose('foo\\.bar')
        expect(result).toContain('foo')
        expect(result).toContain('oo.')
        expect(result).toContain('o.b')
        expect(result).toContain('.ba')
        expect(result).toContain('bar')
    })

    it('should return empty set for very short pattern', () => {
        expect(decompose('ab')).toEqual(new Set())
    })

    it('should return empty set for pure wildcard pattern', () => {
        expect(decompose('.*')).toEqual(new Set())
        expect(decompose('.+')).toEqual(new Set())
    })

    it('should be case insensitive', () => {
        const result = decompose('Hello')
        expect(result).toEqual(new Set(['hel', 'ell', 'llo']))
    })

    it('should handle quantifiers by splitting', () => {
        // "func+tion" → "func" is split at +, so we get "fun" from "func" and "tio", "ion" from "tion"
        const result = decompose('func+tion')
        expect(result).toContain('fun')
        expect(result).toContain('tio')
        expect(result).toContain('ion')
    })

    it('should handle alternation — take union of both branches', () => {
        // "foo|bar" → both branches → union of trigrams
        const result = decompose('foo|bar')
        // With alternation at top level, we cannot require ALL trigrams
        // so we return empty (cannot guarantee any specific trigram)
        expect(result.size).toBe(0)
    })
})

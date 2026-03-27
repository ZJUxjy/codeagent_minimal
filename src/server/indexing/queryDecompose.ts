import { extractTrigrams } from './trigram.js'

/**
 * Decomposes a regex pattern into trigrams usable for index queries.
 *
 * Strategy:
 * 1. Split pattern at metacharacters into literal segments
 * 2. Extract trigrams from each literal segment
 * 3. Merge all trigrams (AND semantics: candidate files must contain all)
 *
 * Limitations:
 * - Top-level alternation (|) → returns empty set (fallback to full scan)
 * - Character classes [...] treated as split points
 * - Quantifiers +*?{} treated as split points
 */
export function decompose(pattern: string): Set<string> {
    // Top-level alternation: can't extract common trigrams for AND query
    if (hasTopLevelAlternation(pattern)) {
        return new Set()
    }

    const literals = extractLiterals(pattern)
    const trigrams = new Set<string>()
    for (const lit of literals) {
        for (const tri of extractTrigrams(lit)) {
            trigrams.add(tri)
        }
    }
    return trigrams
}

/** Checks for unparenthesized top-level | */
function hasTopLevelAlternation(pattern: string): boolean {
    let depth = 0
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]
        if (ch === '\\') { i++; continue }
        if (ch === '(' || ch === '[') depth++
        else if (ch === ')' || ch === ']') depth--
        else if (ch === '|' && depth === 0) return true
    }
    return false
}

/**
 * Extracts literal segments from a regex pattern.
 * Metacharacters ( . * + ? { } [ ] ^ $ | ) act as split points,
 * but backslash-escaped chars are treated as literals.
 */
function extractLiterals(pattern: string): string[] {
    const literals: string[] = []
    let current = ''
    let i = 0

    while (i < pattern.length) {
        const ch = pattern[i]

        if (ch === '\\' && i + 1 < pattern.length) {
            // Escaped char → treat as literal
            current += pattern[i + 1]
            i += 2
            continue
        }

        if (isMetaChar(ch)) {
            if (ch === '[') {
                // Skip entire character class
                if (current.length > 0) { literals.push(current); current = '' }
                i = skipCharClass(pattern, i)
                continue
            }
            if (current.length > 0) { literals.push(current); current = '' }
            i++
            continue
        }

        current += ch
        i++
    }

    if (current.length > 0) literals.push(current)
    return literals
}

function isMetaChar(ch: string): boolean {
    return '.*+?{}[]()^$|'.includes(ch)
}

/** Skips a [...] char class, returns position after ] */
function skipCharClass(pattern: string, start: number): number {
    let i = start + 1 // skip [
    if (i < pattern.length && pattern[i] === '^') i++
    if (i < pattern.length && pattern[i] === ']') i++ // literal ]
    while (i < pattern.length) {
        if (pattern[i] === '\\') { i += 2; continue }
        if (pattern[i] === ']') return i + 1
        i++
    }
    return i
}

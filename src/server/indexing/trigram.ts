/**
 * Extracts all overlapping 3-character sequences from text.
 * Lowercased for case-insensitive indexing.
 */
export function extractTrigrams(text: string): Set<string> {
    const lower = text.toLowerCase()
    const trigrams = new Set<string>()
    for (let i = 0; i <= lower.length - 3; i++) {
        trigrams.add(lower.slice(i, i + 3))
    }
    return trigrams
}

/**
 * Trigram inverted index: trigram → Set<filePath>.
 * Query intersects posting lists to return candidate files likely containing the target text.
 */
export class TrigramIndex {
    private postings = new Map<string, Set<string>>()
    /** filePath → trigrams, kept to clean up postings on remove */
    private fileTrigrams = new Map<string, Set<string>>()

    get size(): number {
        return this.fileTrigrams.size
    }

    addFile(filePath: string, content: string): void {
        const trigrams = extractTrigrams(content)
        this.fileTrigrams.set(filePath, trigrams)
        for (const tri of trigrams) {
            let set = this.postings.get(tri)
            if (!set) {
                set = new Set()
                this.postings.set(tri, set)
            }
            set.add(filePath)
        }
    }

    removeFile(filePath: string): void {
        const trigrams = this.fileTrigrams.get(filePath)
        if (!trigrams) return
        for (const tri of trigrams) {
            const set = this.postings.get(tri)
            if (set) {
                set.delete(filePath)
                if (set.size === 0) this.postings.delete(tri)
            }
        }
        this.fileTrigrams.delete(filePath)
    }

    updateFile(filePath: string, newContent: string): void {
        this.removeFile(filePath)
        this.addFile(filePath, newContent)
    }

    /**
     * Returns files containing all given trigrams.
     * Empty trigram set → returns all indexed files (cannot filter).
     */
    query(trigrams: Set<string>): string[] {
        if (trigrams.size === 0) {
            return Array.from(this.fileTrigrams.keys())
        }

        let result: Set<string> | null = null
        // Sort by posting list size ascending — intersect smallest first for early exit
        const sorted = Array.from(trigrams).sort((a, b) => {
            const sizeA = this.postings.get(a)?.size ?? 0
            const sizeB = this.postings.get(b)?.size ?? 0
            return sizeA - sizeB
        })

        for (const tri of sorted) {
            const posting = this.postings.get(tri)
            if (!posting || posting.size === 0) return []
            if (result === null) {
                result = new Set(posting)
            } else {
                for (const file of result) {
                    if (!posting.has(file)) result.delete(file)
                }
                if (result.size === 0) return []
            }
        }

        return result ? Array.from(result) : []
    }

}

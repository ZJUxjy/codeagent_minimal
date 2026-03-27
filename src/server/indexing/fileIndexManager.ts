import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import fg from 'fast-glob'
import { TrigramIndex } from './trigram.js'
import { decompose } from './queryDecompose.js'

export const IGNORED_DIRS = ['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv']
const IGNORED_EXTENSIONS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
    '.woff', '.woff2', '.ttf', '.eot',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx',
    '.mp3', '.mp4', '.avi', '.mov', '.wav',
    '.exe', '.dll', '.so', '.dylib', '.o',
    '.lock', '.map',
])

const MAX_FILE_SIZE = 512 * 1024 // 512KB — skip very large files
const IGNORE_PATTERNS = IGNORED_DIRS.map(d => `${d}/**`)

export class FileIndexManager {
    private index = new TrigramIndex()
    private cwd: string
    private ready = false
    /** Content length cache, used to skip no-op index updates */
    private contentLengths = new Map<string, number>()

    constructor(cwd: string) {
        this.cwd = cwd
    }

    get isReady(): boolean {
        return this.ready
    }

    get indexedFileCount(): number {
        return this.index.size
    }

    async build(): Promise<void> {
        const files = await fg('**/*', {
            cwd: this.cwd,
            ignore: IGNORE_PATTERNS,
            absolute: true,
            onlyFiles: true,
        })

        await Promise.all(
            files
                .filter(f => !IGNORED_EXTENSIONS.has(extname(f).toLowerCase()))
                .map(async (filePath) => {
                    try {
                        const { size } = await stat(filePath)
                        if (size > MAX_FILE_SIZE) return
                        const content = await readFile(filePath, 'utf-8')
                        this.index.addFile(filePath, content)
                        this.contentLengths.set(filePath, content.length)
                    } catch {
                        // Skip unreadable files (binary, permissions, etc.)
                    }
                })
        )

        this.ready = true
    }

    /**
     * Returns candidate file paths that may match the pattern.
     * Returns null when the index is not ready or trigrams cannot be extracted
     * (caller should fall back to full scan).
     */
    search(pattern: string): string[] | null {
        if (!this.ready) return null
        const trigrams = decompose(pattern)
        if (trigrams.size === 0) return null
        return this.index.query(trigrams)
    }

    /** Notify that a file was changed by write/edit tool. */
    onFileChanged(filePath: string, newContent: string): void {
        if (IGNORED_EXTENSIONS.has(extname(filePath).toLowerCase())) return
        if (newContent.length > MAX_FILE_SIZE) {
            this.index.removeFile(filePath)
            this.contentLengths.delete(filePath)
            return
        }
        const prevLen = this.contentLengths.get(filePath)
        if (prevLen === newContent.length) return
        this.index.updateFile(filePath, newContent)
        this.contentLengths.set(filePath, newContent.length)
    }

    /** Notify that a file was removed. */
    onFileRemoved(filePath: string): void {
        this.index.removeFile(filePath)
        this.contentLengths.delete(filePath)
    }
}

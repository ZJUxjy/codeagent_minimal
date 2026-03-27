import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import fg from 'fast-glob'
import { TrigramIndex } from './trigram.js'
import { decompose } from './queryDecompose.js'

const IGNORED_DIRS = ['node_modules', '.git', 'dist', '.next', '__pycache__', '.venv']
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
                    } catch {
                        // Skip unreadable files (binary, permissions, etc.)
                    }
                })
        )

        this.ready = true
    }

    search(pattern: string): string[] {
        if (!this.ready) return []
        const trigrams = decompose(pattern)
        return this.index.query(trigrams)
    }

    onFileChanged(filePath: string, newContent: string): void {
        if (IGNORED_EXTENSIONS.has(extname(filePath).toLowerCase())) return
        if (newContent.length > MAX_FILE_SIZE) {
            this.index.removeFile(filePath)
            return
        }
        this.index.updateFile(filePath, newContent)
    }

    onFileRemoved(filePath: string): void {
        this.index.removeFile(filePath)
    }
}

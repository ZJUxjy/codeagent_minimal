import { readFile } from 'fs/promises'
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

const MAX_FILE_SIZE = 512 * 1024 // 512KB — 跳过超大文件

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
        const ignorePatterns = IGNORED_DIRS.map(d => `${d}/**`)
        const files = await fg('**/*', {
            cwd: this.cwd,
            ignore: ignorePatterns,
            absolute: true,
            onlyFiles: true,
            stats: false,
        })

        const readPromises = files
            .filter(f => !IGNORED_EXTENSIONS.has(extname(f).toLowerCase()))
            .map(async (filePath) => {
                try {
                    const content = await readFile(filePath, 'utf-8')
                    if (content.length <= MAX_FILE_SIZE) {
                        this.index.addFile(filePath, content)
                    }
                } catch {
                    // 跳过无法读取的文件（二进制等）
                }
            })

        await Promise.all(readPromises)
        this.ready = true
    }

    /**
     * 给定正则模式，返回可能匹配的候选文件路径列表。
     * 如果索引未就绪或无法提取 trigram，返回空数组（调用方应退化为全扫描）。
     */
    search(pattern: string): string[] {
        if (!this.ready) return []
        const trigrams = decompose(pattern)
        return this.index.query(trigrams)
    }

    /**
     * 文件变更通知 — write/edit 工具调用后触发。
     */
    onFileChanged(filePath: string, newContent: string): void {
        if (IGNORED_EXTENSIONS.has(extname(filePath).toLowerCase())) return
        if (newContent.length > MAX_FILE_SIZE) {
            this.index.removeFile(filePath)
            return
        }
        this.index.updateFile(filePath, newContent)
    }

    /**
     * 文件删除通知。
     */
    onFileRemoved(filePath: string): void {
        this.index.removeFile(filePath)
    }
}

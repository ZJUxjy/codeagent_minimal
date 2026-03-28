import { watch, type FSWatcher } from "chokidar"
import * as path from "path"
import { loadSkills } from "./loader.js"
import type { SkillLoadResult } from "./types.js"

export interface SkillWatcherCallbacks {
    /** Called when skills are reloaded */
    onReload: (result: SkillLoadResult) => void
    /** Called on watcher error */
    onError?: (error: Error) => void
}

export class SkillWatcher {
    private watcher?: FSWatcher
    private cwd: string
    private debounceTimer?: ReturnType<typeof setTimeout>
    private readonly debounceMs: number

    constructor(cwd: string, debounceMs = 150) {
        this.cwd = cwd
        this.debounceMs = debounceMs
    }

    async start(callbacks: SkillWatcherCallbacks): Promise<void> {
        const initial = await loadSkills(this.cwd)

        // Collect parent directories of each skill's baseDir to watch
        const dirsToWatch = new Set<string>()
        for (const skill of initial.skills) {
            const parentDir = path.dirname(skill.baseDir)
            dirsToWatch.add(parentDir)
        }

        // Also watch common skill discovery paths so new skills are detected
        const discoveryBases = [
            path.join(this.cwd, ".lop", "skills"),
            path.join(this.cwd, ".agents", "skills"),
        ]
        for (const base of discoveryBases) {
            dirsToWatch.add(base)
        }

        if (dirsToWatch.size === 0) return

        this.watcher = watch(Array.from(dirsToWatch), {
            ignoreInitial: true,
            ignored: /(^|[/\\])\../,
            persistent: true,
            depth: 3,
        })

        const debouncedReload = (): void => {
            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(async () => {
                try {
                    const result = await loadSkills(this.cwd)
                    callbacks.onReload(result)
                } catch (err) {
                    callbacks.onError?.(
                        err instanceof Error ? err : new Error(String(err)),
                    )
                }
            }, this.debounceMs)
        }

        this.watcher.on("add", debouncedReload)
        this.watcher.on("change", debouncedReload)
        this.watcher.on("unlink", debouncedReload)
        this.watcher.on("unlinkDir", debouncedReload)
        this.watcher.on("addDir", debouncedReload)
    }

    async stop(): Promise<void> {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        await this.watcher?.close()
        this.watcher = undefined
    }
}

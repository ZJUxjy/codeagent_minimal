import { existsSync } from "fs"
import * as path from "path"

/** Walk upward from startDir to find the nearest .git directory. */
export function findGitRoot(startDir: string): string | null {
    let current = path.resolve(startDir)

    while (true) {
        const gitPath = path.join(current, ".git")
        if (existsSync(gitPath)) {
            return current
        }

        const parent = path.dirname(current)
        if (parent === current) {
            return null
        }
        current = parent
    }
}

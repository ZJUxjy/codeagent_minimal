import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"
import { spawn } from "child_process"
import { existsSync } from "fs"
import { readRegistry, writeRegistry, getPackage, type InstalledPackage } from "./registry.js"

const SOURCES_DIR = path.join(os.homedir(), ".lop", "sources")

/** Run a git command and return stdout. Rejects on non-zero exit. */
function git(args: string[], cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const proc = spawn("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
        let stdout = ""
        let stderr = ""
        proc.stdout.on("data", (d: Buffer) => { stdout += d.toString() })
        proc.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
        proc.on("close", code => {
            if (code === 0) resolve(stdout.trim())
            else reject(new Error(`git ${args[0]} failed: ${stderr.trim()}`))
        })
    })
}

/** Derive a short package name from a git URL. */
function nameFromUrl(url: string): string {
    return url.replace(/\.git$/, "").split("/").pop() ?? url
}

/** Detect which subdirectory contains skill packages (directories with SKILL.md). */
async function detectSkillsDir(sourcePath: string): Promise<string> {
    const candidates = ["skills", "."]
    for (const candidate of candidates) {
        const dir = path.join(sourcePath, candidate)
        if (!existsSync(dir)) continue
        const entries = await fs.readdir(dir, { withFileTypes: true })
        const hasSkill = entries.some(
            e => e.isDirectory() && existsSync(path.join(dir, e.name, "SKILL.md"))
        )
        if (hasSkill) return candidate
    }
    throw new Error("No skill packages found in the repository (expected a skills/ directory or root-level skill directories)")
}

// TODO(human): implement installPackage(url: string): Promise<InstalledPackage>
//
// Steps:
//   1. Derive name from URL via nameFromUrl(url)
//   2. Read registry — throw if name already installed
//   3. Compute destPath = path.join(SOURCES_DIR, name)
//      Throw if destPath already exists on disk (partial install)
//   4. fs.mkdir(SOURCES_DIR, { recursive: true })
//   5. git(["clone", url, destPath]) — this is the slow step
//   6. detectSkillsDir(destPath) to find where skills live
//   7. Build InstalledPackage, push to registry.packages, writeRegistry
//   8. Return the InstalledPackage
export async function installPackage(_url: string): Promise<InstalledPackage> {
    throw new Error("Not yet implemented")
}

export async function uninstallPackage(name: string): Promise<void> {
    const registry = await readRegistry()
    const pkg = getPackage(registry, name)
    if (!pkg) throw new Error(`Package '${name}' is not installed`)

    await fs.rm(pkg.sourcePath, { recursive: true, force: true })
    registry.packages = registry.packages.filter(p => p.name.toLowerCase() !== name.toLowerCase())
    await writeRegistry(registry)
}

export async function updatePackage(name: string): Promise<void> {
    const registry = await readRegistry()
    const pkg = getPackage(registry, name)
    if (!pkg) throw new Error(`Package '${name}' is not installed`)
    if (!existsSync(pkg.sourcePath)) throw new Error(`Source directory missing for '${name}': ${pkg.sourcePath}`)

    await git(["pull", "--ff-only"], pkg.sourcePath)
}

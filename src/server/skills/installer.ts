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

export async function installPackage(url: string): Promise<InstalledPackage> {
    const name = nameFromUrl(url)
    const registry = await readRegistry()
    if (getPackage(registry, name)) {
        throw new Error(`Package '${name}' is already installed`)
    }
    const destPath = path.join(SOURCES_DIR, name)
    if (existsSync(destPath)) {
        await fs.rm(destPath, { recursive: true, force: true })
    }
    await fs.mkdir(SOURCES_DIR, { recursive: true })
    await git(["clone", url, destPath])
    const skillsDir = await detectSkillsDir(destPath)
    const pkg: InstalledPackage = {
        name,
        url,
        installedAt: new Date().toISOString(),
        sourcePath: destPath,
        skillsDir,
    }
    registry.packages.push(pkg)
    await writeRegistry(registry)
    return pkg
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

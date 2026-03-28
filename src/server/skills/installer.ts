import * as fs from "fs/promises"
import * as path from "path"
import { spawn } from "child_process"
import { existsSync } from "fs"
import { getBaseDir } from "../utils/storagePath.js"
import { readRegistry, writeRegistry, getPackage, type InstalledPackage } from "./registry.js"

const IGNORE_DIRS = new Set([".git", "node_modules", ".svn", ".hg"])

function getSourcesDir(): string {
    return path.join(getBaseDir(), "sources")
}

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

export function nameFromUrl(url: string): string {
    let cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "")
    if (cleaned.includes("@") && cleaned.includes(":")) {
        cleaned = cleaned.split(":").pop() ?? cleaned
       }
    const name = cleaned.split("/").pop()
    if (!name) throw new Error(`Cannot derive package name from URL: ${url}`)
    return name
}

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

    const rootEntries = await fs.readdir(sourcePath, { withFileTypes: true })
    for (const entry of rootEntries) {
        if (!entry.isDirectory() || IGNORE_DIRS.has(entry.name)) continue
        const subDir = path.join(sourcePath, entry.name)
        try {
            const subEntries = await fs.readdir(subDir, { withFileTypes: true })
            const hasSkill = subEntries.some(
                e => e.isDirectory() && existsSync(path.join(subDir, e.name, "SKILL.md"))
            )
            if (hasSkill) return entry.name
        } catch {
            // Skip unreadable directories
        }
    }

    throw new Error("No skill packages found in the repository (expected a skills/ directory or root-level skill directories)")
}

export async function installPackage(url: string): Promise<InstalledPackage> {
    const name = nameFromUrl(url)
    const registry = await readRegistry()
    if (getPackage(registry, name)) {
        throw new Error(`Package '${name}' is already installed`)
    }
    const sourcesDir = getSourcesDir()
    const destPath = path.join(sourcesDir, name)
    if (existsSync(destPath)) {
        if (!existsSync(path.join(destPath, ".git"))) {
            throw new Error(
                `Directory '${destPath}' already exists and is not a git repository. ` +
                `Remove it manually or use a different package name.`
            )
        }
        await fs.rm(destPath, { recursive: true, force: true })
    }
    await fs.mkdir(sourcesDir, { recursive: true })
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

    const newSkillsDir = await detectSkillsDir(pkg.sourcePath)
    if (newSkillsDir !== pkg.skillsDir) {
        pkg.skillsDir = newSkillsDir
    }
    pkg.installedAt = new Date().toISOString()
    await writeRegistry(registry)
}

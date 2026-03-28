import * as fs from "fs/promises"
import * as path from "path"
import { getBaseDir } from "../utils/storagePath.js"

function getRegistryPath(): string {
    return path.join(getBaseDir(), "installed.json")
}

export interface InstalledPackage {
    name: string
    url: string
    installedAt: string
    sourcePath: string
    skillsDir: string   // relative to sourcePath, e.g. "skills" or "."
}

export interface Registry {
    packages: InstalledPackage[]
}

export async function readRegistry(): Promise<Registry> {
    const registryPath = getRegistryPath()
    try {
        const content = await fs.readFile(registryPath, "utf8")
        try {
            return JSON.parse(content) as Registry
        } catch {
            console.warn(`Registry file corrupt (${registryPath}), resetting to empty.`)
            return { packages: [] }
        }
    } catch (err: any) {
        if (err.code === "ENOENT") return { packages: [] }
        throw err
    }
}

export async function writeRegistry(registry: Registry): Promise<void> {
    const registryPath = getRegistryPath()
    const dir = path.dirname(registryPath)
    await fs.mkdir(dir, { recursive: true })
    const tmpPath = registryPath + ".tmp"
    await fs.writeFile(tmpPath, JSON.stringify(registry, null, 2), "utf8")
    await fs.rename(tmpPath, registryPath)
}

export function getPackage(registry: Registry, name: string): InstalledPackage | undefined {
    return registry.packages.find(p => p.name.toLowerCase() === name.toLowerCase())
}

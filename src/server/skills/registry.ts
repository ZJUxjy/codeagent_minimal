import * as fs from "fs/promises"
import * as os from "os"
import * as path from "path"

const REGISTRY_PATH = path.join(os.homedir(), ".lop", "installed.json")

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
    try {
        const content = await fs.readFile(REGISTRY_PATH, "utf8")
        return JSON.parse(content) as Registry
    } catch (err: any) {
        if (err.code === "ENOENT") return { packages: [] }
        throw err
    }
}

export async function writeRegistry(registry: Registry): Promise<void> {
    await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true })
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), "utf8")
}

export function getPackage(registry: Registry, name: string): InstalledPackage | undefined {
    return registry.packages.find(p => p.name.toLowerCase() === name.toLowerCase())
}

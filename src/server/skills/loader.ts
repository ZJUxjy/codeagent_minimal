import * as fs from "fs/promises"
import { existsSync } from "fs"
import * as os from "os"
import * as path from "path"
import { parse as parseYaml } from "yaml"
import type { LopConfig } from "../../protocol/types.js"
import type { Skill, SkillLoadResult } from "./types.js"
import { readRegistry } from "./registry.js"

const ROOT_DIR = ".lop"
const SKILLS_DIR = "skills"

interface ParsedFrontmatter {
    name?: string
    description?: string
    disableModelInvocation: boolean
}

function parseFrontmatter(markdown: string): ParsedFrontmatter {
    if (!markdown.startsWith("---\n")) {
        return { disableModelInvocation: false }
    }

    const endIndex = markdown.indexOf("\n---", 4)
    if (endIndex === -1) {
        return { disableModelInvocation: false }
    }

    const yamlString = markdown.slice(4, endIndex)
    let raw: Record<string, unknown> = {}
    try {
        raw = (parseYaml(yamlString) as Record<string, unknown>) ?? {}
    } catch {
        return { disableModelInvocation: false }
    }

    return {
        name: typeof raw["name"] === "string" ? raw["name"] : undefined,
        description: typeof raw["description"] === "string" ? raw["description"].trimEnd() : undefined,
        disableModelInvocation: raw["disable-model-invocation"] === true,
    }
}

function findGitRoot(startDir: string): string | null {
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

async function listSkillDirectories(root: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(root, { withFileTypes: true })
        return entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, entry.name))
    } catch (error: unknown) {
        const err = error as NodeJS.ErrnoException
        if (err.code === "ENOENT") return []
        throw error
    }
}

function buildDiscoveryPaths(cwd: string, config?: LopConfig): string[] {
    const paths: string[] = []

    // Custom paths have highest priority (first-discovered wins, so highest priority goes first)
    const envPaths = (process.env.LOP_SKILLS_PATHS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)

    const configPaths = config?.skills?.paths ?? []
    for (const customPath of [...envPaths, ...configPaths]) {
        paths.push(path.resolve(cwd, customPath))
    }

    // Project-level skills override global defaults
    const gitRoot = findGitRoot(cwd)
    if (gitRoot) {
        paths.push(path.join(gitRoot, ROOT_DIR, SKILLS_DIR))
    }

    // Global user skills have lowest priority
    paths.push(path.join(os.homedir(), ROOT_DIR, SKILLS_DIR))

    // 去重，保持顺序
    return Array.from(new Set(paths))
}

async function loadSkillFromDir(skillDir: string, diagnostics: string[]): Promise<Skill | null> {
    const filePath = path.join(skillDir, "SKILL.md")
    if (!existsSync(filePath)) return null

    let content = ""
    try {
        content = await fs.readFile(filePath, "utf8")
    } catch (error: any) {
        diagnostics.push(`Skipped skill at ${filePath}: failed to read file (${error.message}).`)
        return null
    }
    const frontmatter = parseFrontmatter(content)

    const dirName = path.basename(skillDir)
    const name = (frontmatter.name ?? dirName).trim()
    const description = (frontmatter.description ?? "").trim()

    if (!description) {
        diagnostics.push(`Skipped skill '${dirName}' at ${filePath}: missing description in frontmatter.`)
        return null
    }

    if (!frontmatter.name) {
        diagnostics.push(`Skill '${dirName}' at ${filePath}: missing name in frontmatter, fallback to directory name.`)
    } else if (frontmatter.name.trim() !== dirName) {
        diagnostics.push(`Skill '${dirName}' at ${filePath}: frontmatter name '${frontmatter.name}' does not match directory name.`)
    }

    return {
        name,
        description,
        filePath,
        baseDir: skillDir,
        disableModelInvocation: frontmatter.disableModelInvocation,
    }
}

export async function loadSkills(cwd: string, config?: LopConfig): Promise<SkillLoadResult> {
    const diagnostics: string[] = []
    const skills: Skill[] = []
    const byName = new Set<string>()

    // Installed packages (lowest priority — appended after static paths)
    const registryPaths: string[] = []
    try {
        const registry = await readRegistry()
        for (const pkg of registry.packages) {
            registryPaths.push(path.join(pkg.sourcePath, pkg.skillsDir))
        }
    } catch {
        // Registry errors are non-fatal
    }

    const allPaths = [...buildDiscoveryPaths(cwd, config), ...registryPaths]

    for (const discoveryPath of allPaths) {
        let skillDirs: string[] = []
        try {
            skillDirs = await listSkillDirectories(discoveryPath)
        } catch (error: any) {
            diagnostics.push(`Failed to read skill directory '${discoveryPath}': ${error.message}`)
            continue
        }

        for (const skillDir of skillDirs) {
            const skill = await loadSkillFromDir(skillDir, diagnostics)
            if (!skill) continue

            const normalizedName = skill.name.toLowerCase()
            if (byName.has(normalizedName)) {
                diagnostics.push(`Skipped skill '${skill.name}' at ${skill.filePath}: duplicate skill name already loaded.`)
                continue
            }

            byName.add(normalizedName)
            skills.push(skill)
        }
    }

    return { skills, diagnostics }
}

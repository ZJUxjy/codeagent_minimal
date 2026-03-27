import * as fs from "fs/promises"
import { existsSync } from "fs"
import * as os from "os"
import * as path from "path"
import type { LopConfig } from "../../protocol/types.js"
import type { Skill, SkillLoadResult } from "./types.js"

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

    const lines = markdown.split("\n")
    let end = -1
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim() === "---") {
            end = i
            break
        }
    }

    if (end === -1) {
        return { disableModelInvocation: false }
    }

    const parsed: ParsedFrontmatter = { disableModelInvocation: false }

    for (const rawLine of lines.slice(1, end)) {
        const line = rawLine.trim()
        if (!line || line.startsWith("#")) continue

        const idx = line.indexOf(":")
        if (idx < 0) continue

        const key = line.slice(0, idx).trim().toLowerCase()
        const valueRaw = line.slice(idx + 1).trim()
        const value = valueRaw.replace(/^['\"]|['\"]$/g, "")

        if (key === "name") {
            parsed.name = value
        } else if (key === "description") {
            parsed.description = value
        } else if (key === "disable-model-invocation") {
            parsed.disableModelInvocation = value.toLowerCase() === "true"
        }
    }

    return parsed
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

    paths.push(path.join(os.homedir(), ROOT_DIR, SKILLS_DIR))

    const gitRoot = findGitRoot(cwd)
    if (gitRoot) {
        paths.push(path.join(gitRoot, ROOT_DIR, SKILLS_DIR))
    }

    const envPaths = (process.env.LOP_SKILLS_PATHS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)

    const configPaths = config?.skills?.paths ?? []
    const customPaths = [...envPaths, ...configPaths]

    for (const customPath of customPaths) {
        paths.push(path.resolve(cwd, customPath))
    }

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

    for (const discoveryPath of buildDiscoveryPaths(cwd, config)) {
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

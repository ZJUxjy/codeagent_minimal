import * as fs from "fs/promises"
import { existsSync } from "fs"
import * as os from "os"
import * as path from "path"
import { parse as parseYaml } from "yaml"
import type { LopConfig } from "../../protocol/types.js"
import type { Skill, SkillLoadResult, SkillPromptOptions } from "./types.js"
import { readRegistry } from "./registry.js"
import { findGitRoot } from "../utils/git.js"

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
        paths.push(path.join(gitRoot, ".agents", SKILLS_DIR))
    }

    // Global user skills have lowest priority
    paths.push(path.join(os.homedir(), ROOT_DIR, SKILLS_DIR))
    paths.push(path.join(os.homedir(), ".agents", SKILLS_DIR))

    // Deduplicate while preserving order
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

export function buildSkillsPromptSection(skills: Skill[], opts?: SkillPromptOptions): string | undefined {
    const enabled = skills.filter((skill) => !skill.disableModelInvocation)
    if (enabled.length === 0) return undefined

    const maxChars = opts?.maxChars ?? 3000

    const escapeXml = (str: string) =>
        str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

    const header = [
        "The following skills provide specialized instructions for specific tasks.",
        "You have a `skill` tool to load the full instructions when the task matches its description.",
        "When a skill references relative paths, resolve them against the skill directory.",
        "",
        "<available_skills>",
    ].join("\n")

    const fullItems = enabled.map((skill) => [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <location>${skill.filePath}</location>`,
        "  </skill>",
    ].join("\n"))

    const fullBody = `${header}\n${fullItems.join("\n")}\n</available_skills>`
    if (fullBody.length <= maxChars) return fullBody

    const compactItems = enabled.map((skill) => [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <location>${skill.filePath}</location>`,
        "  </skill>",
    ].join("\n"))

    const compactBody = `${header}\n${compactItems.join("\n")}\n</available_skills>`
    if (compactBody.length <= maxChars) return compactBody

    const truncated = compactItems.slice(
        0,
        Math.floor(enabled.length * maxChars / compactBody.length),
    )
    return [
        header,
        truncated.join("\n"),
        `  <!-- ${enabled.length - truncated.length} more skills omitted (budget exceeded) -->`,
        "</available_skills>",
    ].join("\n")
}

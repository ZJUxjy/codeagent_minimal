import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { loadSkills } from "./loader.js"

describe("loadSkills", () => {
    let tmpRoot: string
    let homeDir: string
    let projectDir: string
    let oldHome: string | undefined

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lop-skills-"))
        homeDir = path.join(tmpRoot, "home")
        projectDir = path.join(tmpRoot, "project")

        await fs.mkdir(homeDir, { recursive: true })
        await fs.mkdir(projectDir, { recursive: true })
        await fs.mkdir(path.join(projectDir, ".git"), { recursive: true })

        oldHome = process.env.HOME
        process.env.HOME = homeDir
    })

    afterEach(async () => {
        if (oldHome === undefined) {
            delete process.env.HOME
        } else {
            process.env.HOME = oldHome
        }
        delete process.env.LOP_SKILLS_PATHS
        await fs.rm(tmpRoot, { recursive: true, force: true })
    })

    it("loads skills from project directory with parsed metadata", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "demo-skill")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            `---\nname: demo-skill\ndescription: Demo description\ndisable-model-invocation: true\n---\n\ncontent`,
            "utf8",
        )

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(1)
        expect(result.skills[0]).toMatchObject({
            name: "demo-skill",
            description: "Demo description",
            disableModelInvocation: true,
            baseDir: skillDir,
        })
    })

    it("skips skills without description", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "bad-skill")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(path.join(skillDir, "SKILL.md"), `---\nname: bad-skill\n---\n`, "utf8")

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(0)
        expect(result.diagnostics.some((d) => d.includes("missing description"))).toBe(true)
    })

    it("keeps first discovered skill on name collision", async () => {
        const userSkillDir = path.join(homeDir, ".lop", "skills", "dup")
        const projectSkillDir = path.join(projectDir, ".lop", "skills", "dup")

        await fs.mkdir(userSkillDir, { recursive: true })
        await fs.mkdir(projectSkillDir, { recursive: true })

        await fs.writeFile(
            path.join(userSkillDir, "SKILL.md"),
            `---\nname: dup\ndescription: user skill\n---\n`,
            "utf8",
        )
        await fs.writeFile(
            path.join(projectSkillDir, "SKILL.md"),
            `---\nname: dup\ndescription: project skill\n---\n`,
            "utf8",
        )

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(1)
        expect(result.skills[0].description).toBe("project skill")
        expect(result.diagnostics.some((d) => d.includes("duplicate skill name"))).toBe(true)
    })

    it("records diagnostic when frontmatter name mismatches directory", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "dir-name")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            `---\nname: another-name\ndescription: mismatch\n---\n`,
            "utf8",
        )

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(1)
        expect(result.diagnostics.some((d) => d.includes("does not match directory name"))).toBe(true)
    })

    it("discovers skills from .agents/skills/ directory", async () => {
        const skillDir = path.join(projectDir, ".agents", "skills", "agent-skill")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            `---\nname: agent-skill\ndescription: Skill from .agents directory\n---\n\ncontent`,
            "utf8",
        )

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(1)
        expect(result.skills[0]).toMatchObject({
            name: "agent-skill",
            description: "Skill from .agents directory",
            baseDir: skillDir,
        })
    })

    it(".lop/skills/ takes priority over .agents/skills/ on name collision", async () => {
        const lopSkillDir = path.join(projectDir, ".lop", "skills", "shared")
        const agentsSkillDir = path.join(projectDir, ".agents", "skills", "shared")

        await fs.mkdir(lopSkillDir, { recursive: true })
        await fs.mkdir(agentsSkillDir, { recursive: true })

        await fs.writeFile(
            path.join(lopSkillDir, "SKILL.md"),
            `---\nname: shared\ndescription: lop version\n---\n`,
            "utf8",
        )
        await fs.writeFile(
            path.join(agentsSkillDir, "SKILL.md"),
            `---\nname: shared\ndescription: agents version\n---\n`,
            "utf8",
        )

        const result = await loadSkills(projectDir)

        expect(result.skills).toHaveLength(1)
        expect(result.skills[0].description).toBe("lop version")
        expect(result.diagnostics.some((d) => d.includes("duplicate skill name"))).toBe(true)
    })
})

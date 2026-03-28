import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import * as os from "os"
import { loadSkills, buildSkillsPromptSection } from "../loader.js"
import { createSkillTool } from "../../tools/skill.js"

describe("skills system integration", () => {
    let tmpRoot: string
    let homeDir: string
    let projectDir: string
    let oldHome: string | undefined

    beforeEach(async () => {
        tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "lop-int-"))
        homeDir = path.join(tmpRoot, "home")
        projectDir = path.join(tmpRoot, "project")
        await fs.mkdir(homeDir, { recursive: true })
        await fs.mkdir(projectDir, { recursive: true })
        await fs.mkdir(path.join(projectDir, ".git"), { recursive: true })
        oldHome = process.env.HOME
        process.env.HOME = homeDir
    })

    afterEach(async () => {
        if (oldHome === undefined) delete process.env.HOME
        else process.env.HOME = oldHome
        delete process.env.LOP_SKILLS_PATHS
        await fs.rm(tmpRoot, { recursive: true, force: true })
    })

    it("discovers skills from both .lop/skills and .agents/skills", async () => {
        const lopSkill = path.join(projectDir, ".lop", "skills", "review")
        await fs.mkdir(lopSkill, { recursive: true })
        await fs.writeFile(
            path.join(lopSkill, "SKILL.md"),
            "---\nname: review\ndescription: Code review skill\n---\nReview instructions.",
            "utf8",
        )

        const agentsSkill = path.join(projectDir, ".agents", "skills", "deploy")
        await fs.mkdir(agentsSkill, { recursive: true })
        await fs.writeFile(
            path.join(agentsSkill, "SKILL.md"),
            "---\nname: deploy\ndescription: Deploy skill\n---\nDeploy instructions.",
            "utf8",
        )

        const { skills } = await loadSkills(projectDir)
        expect(skills.length).toBeGreaterThanOrEqual(2)
        expect(skills.map((s) => s.name)).toContain("review")
        expect(skills.map((s) => s.name)).toContain("deploy")
    })

    it("creates a working skill tool from discovered skills", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "test-skill")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            "---\nname: test-skill\ndescription: Test\n---\nActual instructions.",
            "utf8",
        )

        const { skills } = await loadSkills(projectDir)
        const tool = createSkillTool(skills)
        expect(tool.name).toBe("skill")
        expect(tool.description).toContain("test-skill")

        const result = await tool.execute({ name: "test-skill" }, { cwd: projectDir })
        expect(result).toContain("<skill_content")
        expect(result).toContain("Actual instructions.")
    })

    it("builds prompt section with budget management", async () => {
        for (let i = 0; i < 5; i++) {
            const skillDir = path.join(projectDir, ".lop", "skills", `skill-${i}`)
            await fs.mkdir(skillDir, { recursive: true })
            await fs.writeFile(
                path.join(skillDir, "SKILL.md"),
                `---\nname: skill-${i}\ndescription: Skill number ${i}\n---\nInstructions ${i}.`,
                "utf8",
            )
        }

        const { skills } = await loadSkills(projectDir)

        // Full format
        const full = buildSkillsPromptSection(skills)
        expect(full).toContain("<available_skills>")
        expect(full).toContain("<description>")
        expect(full).toContain("skill-0")

        // Compact format (tight budget)
        const compact = buildSkillsPromptSection(skills, { maxChars: 200 })
        expect(compact).toBeDefined()
        expect(compact).toContain("<available_skills>")
    })

    it("excludes disabled skills from tool and prompt", async () => {
        const skillDir = path.join(projectDir, ".lop", "skills", "secret")
        await fs.mkdir(skillDir, { recursive: true })
        await fs.writeFile(
            path.join(skillDir, "SKILL.md"),
            "---\nname: secret\ndescription: Secret skill\ndisable-model-invocation: true\n---\nSecret stuff.",
            "utf8",
        )

        const { skills } = await loadSkills(projectDir)

        const tool = createSkillTool(skills)
        expect(tool.description).not.toContain("secret")

        const prompt = buildSkillsPromptSection(skills)
        expect(prompt).toBeUndefined() // All skills disabled
    })

    it(".lop/skills takes priority over .agents/skills on name collision", async () => {
        const lopDir = path.join(projectDir, ".lop", "skills", "shared")
        await fs.mkdir(lopDir, { recursive: true })
        await fs.writeFile(
            path.join(lopDir, "SKILL.md"),
            "---\nname: shared\ndescription: From .lop\n---\nLop instructions.",
            "utf8",
        )

        const agentsDir = path.join(projectDir, ".agents", "skills", "shared")
        await fs.mkdir(agentsDir, { recursive: true })
        await fs.writeFile(
            path.join(agentsDir, "SKILL.md"),
            "---\nname: shared\ndescription: From .agents\n---\nAgents instructions.",
            "utf8",
        )

        const { skills } = await loadSkills(projectDir)
        expect(skills).toHaveLength(1)
        expect(skills[0].description).toBe("From .lop")

        const tool = createSkillTool(skills)
        const result = await tool.execute({ name: "shared" }, { cwd: projectDir })
        expect(result).toContain("Lop instructions.")
    })
})

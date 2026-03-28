import { describe, it, expect, vi } from "vitest"
import { readFile } from "fs/promises"

vi.mock("fs/promises", () => ({
    readFile: vi.fn(),
}))

import { createSkillTool } from "../../tools/skill.js"
import type { Skill } from "../types.js"

const mockSkills: Skill[] = [
    {
        name: "code-review",
        description: "Review code for quality and security",
        filePath: "/home/user/.lop/skills/code-review/SKILL.md",
        baseDir: "/home/user/.lop/skills/code-review",
        disableModelInvocation: false,
    },
    {
        name: "deploy",
        description: "Deploy to production",
        filePath: "/home/user/.lop/skills/deploy/SKILL.md",
        baseDir: "/home/user/.lop/skills/deploy",
        disableModelInvocation: true,
    },
]

describe("skill tool", () => {
    it("should have correct name and description", () => {
        const tool = createSkillTool(mockSkills)
        expect(tool.name).toBe("skill")
        expect(tool.description).toContain("code-review")
        expect(tool.description).not.toContain("deploy")
    })

    it("should load skill content and return it", async () => {
        const mockContent = "---\nname: code-review\n---\n## Instructions\nReview code."
        vi.mocked(readFile).mockResolvedValue(mockContent)

        const tool = createSkillTool(mockSkills)
        const result = await tool.execute(
            { name: "code-review" },
            { cwd: "/project" },
        )
        expect(result).toContain("<skill_content")
        expect(result).toContain("Review code.")
    })

    it("should return error for unknown skill", async () => {
        const tool = createSkillTool(mockSkills)
        const result = await tool.execute(
            { name: "nonexistent" },
            { cwd: "/project" },
        )
        expect(result).toContain("not found")
    })

    it("should do case-insensitive lookup", async () => {
        const mockContent = "---\nname: code-review\n---\nReview."
        vi.mocked(readFile).mockResolvedValue(mockContent)

        const tool = createSkillTool(mockSkills)
        const result = await tool.execute(
            { name: "Code-Review" },
            { cwd: "/project" },
        )
        expect(result).toContain("<skill_content")
    })
})

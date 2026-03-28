import { describe, it, expect } from "vitest"
import { buildSkillsPromptSection } from "../loader.js"
import type { Skill } from "../types.js"

import type { SkillPromptOptions } from "../types.js"

import * as path from "path"

const makeSkill = (name: string, descLength: number): Skill => ({
    name,
    description: "x".repeat(descLength),
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    disableModelInvocation: false,
})
describe("buildSkillsPromptSection (token budget)", () => {
    it("uses full format when under budget", () => {
        const skills = [makeSkill("a", 50), makeSkill("b", 50)]
        const result = buildSkillsPromptSection(skills, { maxChars: 5000 })
        expect(result).toContain("<description>")
        expect(result).toContain("</available_skills>")
    })
    it("uses compact format (no description) when full exceeds budget", () => {
        const skills = Array.from({ length: 100 }, (_, i) => makeSkill(`skill-${i}`, 200))
        const result = buildSkillsPromptSection(skills, { maxChars: 3000 })
        expect(result).not.toContain("<description>")
        expect(result).toContain("<name>")
    })
    it("truncates skills when even compact exceeds budget", () => {
        const skills = Array.from({ length: 500 }, (_, i) => makeSkill(`s-${i}`, 100))
        const result = buildSkillsPromptSection(skills, { maxChars: 500 })
        expect(result).toContain("more skills omitted")
    })
    it("returns undefined when no enabled skills", () => {
        const skills = [makeSkill("a", 10)]
        skills[0].disableModelInvocation = true
        const result = buildSkillsPromptSection(skills)
        expect(result).toBeUndefined()
    })
})

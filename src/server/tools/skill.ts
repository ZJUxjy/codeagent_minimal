import { z } from "zod"
import { readFile } from "fs/promises"
import type { Tool, ToolContext } from "./types.js"
import type { Skill } from "../skills/types.js"

export function createSkillTool(skills: Skill[]): Tool {
    const available = skills.filter((s) => !s.disableModelInvocation)

    const skillList = available
        .map((s) => `  - ${s.name}: ${s.description}`)
        .join("\n")

    return {
        name: "skill",
        description: [
            "Load a skill's full instructions by name.",
            "Available skills:",
            skillList,
        ].join("\n"),

        parameters: z.object({
            name: z.string().describe("The skill name to load"),
        }),

        async execute(
            { name }: { name: string },
            _ctx: ToolContext,
        ): Promise<string> {
            const skill = available.find(
                (s) => s.name.toLowerCase() === name.toLowerCase(),
            )
            if (!skill) {
                const validNames = available.map((s) => s.name).join(", ")
                return `Skill '${name}' not found. Available: ${validNames}`
            }

            try {
                const content = await readFile(skill.filePath, "utf8")
                return [
                    `<skill_content name="${skill.name}" path="${skill.filePath}">`,
                    content,
                    "</skill_content>",
                ].join("\n")
            } catch (err: any) {
                return `Error loading skill '${skill.name}': ${err.message}`
            }
        },
    }
}

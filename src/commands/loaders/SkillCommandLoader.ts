import type { SlashCommand, SlashCommandActionReturn, CommandContext } from "../types.js"
import { CommandKind } from "../types.js"
import { loadSkills } from "../../server/skills/index.js"
import { readFile } from "fs/promises"
import type { LopConfig } from "../../protocol/types.js"

export class SkillCommandLoader {
    private cachedCommands: SlashCommand[] = []
    private cwd: string
    private config?: LopConfig

    constructor(cwd: string, config?: LopConfig) {
        this.cwd = cwd
        this.config = config
    }

    async loadCommands(): Promise<SlashCommand[]> {
        const { skills } = await loadSkills(this.cwd, this.config)

        this.cachedCommands = skills.map((skill): SlashCommand => ({
            name: skill.name,
            description: skill.description,
            kind: CommandKind.SKILL,
            hidden: skill.disableModelInvocation,
            action: async (
                _context: CommandContext,
                args: string,
            ): Promise<SlashCommandActionReturn> => {
                const skillContent = await readFile(skill.filePath, "utf8")
                const task = args.trim() || `Apply the ${skill.name} skill.`
                return {
                    type: "submit_prompt",
                    content: [
                        `Skill: ${skill.name}`,
                        "",
                        `<skill_definition path="${skill.filePath}">`,
                        skillContent,
                        "</skill_definition>",
                        "",
                        `Task: ${task}`,
                    ].join("\n"),
                }
            },
        }))

        return this.cachedCommands
    }

    /** Reload commands when cwd changes */
    async reload(newCwd: string, config?: LopConfig): Promise<SlashCommand[]> {
        this.cwd = newCwd
        this.config = config
        return this.loadCommands()
    }

    getCached(): SlashCommand[] {
        return this.cachedCommands
    }
}

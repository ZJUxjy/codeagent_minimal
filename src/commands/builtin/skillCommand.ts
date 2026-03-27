import { readFile } from 'fs/promises'
import { CommandKind, type CommandContext, type SlashCommand, type SlashCommandActionReturn } from '../types.js'
import { loadSkills, type Skill } from '../../server/skills/index.js'

async function discoverSkills(context: CommandContext): Promise<{ skills: Skill[]; diagnostics: string[] }> {
    return loadSkills(context.config.cwd, { skills: context.config.skills })
}

export const skillsCommand: SlashCommand = {
    name: 'skills',
    description: 'List loaded skills',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
        const { skills, diagnostics } = await discoverSkills(context)
        if (skills.length === 0) {
            return {
                type: 'message',
                content: 'No skills found. Add skill packages under ~/.lop/skills or .lop/skills.',
            }
        }

        const lines = skills
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((skill) => {
                const mode = skill.disableModelInvocation ? '  [manual-only]' : ''
                return `  ${skill.name} — ${skill.description}${mode}`
            })

        const diagnosticsText = diagnostics.length > 0
            ? `\n\nDiagnostics:\n${diagnostics.map((item) => `  - ${item}`).join('\n')}`
            : ''

        return {
            type: 'message',
            content: `Found ${skills.length} skill(s):\n${lines.join('\n')}${diagnosticsText}`,
        }
    },
}

export const skillCommand: SlashCommand = {
    name: 'skill',
    description: 'Manually invoke a skill. Usage: /skill <name> [task]',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const trimmed = args.trim()
        if (!trimmed) {
            return {
                type: 'message',
                content: 'Usage: /skill <name> [task]',
                isError: true,
            }
        }

        const [name, ...taskParts] = trimmed.split(/\s+/)
        const task = taskParts.join(' ').trim()

        const { skills } = await discoverSkills(context)
        const skill = skills.find((item) => item.name.toLowerCase() === name.toLowerCase())
        if (!skill) {
            return {
                type: 'message',
                content: `Skill not found: ${name}. Run /skills to list available skills.`,
                isError: true,
            }
        }

        const skillContent = await readFile(skill.filePath, 'utf8')
        const taskLine = task || `Please apply the ${skill.name} skill to the current task.`

        return {
            type: 'submit_prompt',
            content: [
                `You must follow this skill before answering: ${skill.name}`,
                '',
                `<skill_definition path="${skill.filePath}">`,
                skillContent,
                '</skill_definition>',
                '',
                `User task: ${taskLine}`,
            ].join('\n'),
        }
    },
}

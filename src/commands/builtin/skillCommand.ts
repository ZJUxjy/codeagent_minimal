import { readFile } from 'fs/promises'
import { CommandKind, type CommandContext, type SlashCommand, type SlashCommandActionReturn } from '../types.js'
import { loadSkills, type Skill } from '../../server/skills/index.js'
import { readRegistry } from '../../server/skills/registry.js'
import { installPackage, uninstallPackage, updatePackage } from '../../server/skills/installer.js'

async function discoverSkills(context: CommandContext): Promise<{ skills: Skill[]; diagnostics: string[] }> {
    return loadSkills(context.config.cwd, { skills: context.config.skills })
}

export const skillsCommand: SlashCommand = {
    name: 'skills',
    description: 'List loaded skills',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
        const [{ skills, diagnostics }, registry] = await Promise.all([
            discoverSkills(context),
            readRegistry(),
        ])

        const lines: string[] = []

        if (skills.length === 0) {
            lines.push('No skills found. Add skill packages under ~/.lop/skills or .lop/skills.')
        } else {
            lines.push(`Found ${skills.length} skill(s):`)
            for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
                const mode = skill.disableModelInvocation ? '  [manual-only]' : ''
                lines.push(`  ${skill.name} — ${skill.description}${mode}`)
            }
        }

        if (registry.packages.length > 0) {
            lines.push('')
            lines.push('Installed packages:')
            for (const pkg of registry.packages) {
                lines.push(`  ${pkg.name}  ${pkg.url}`)
            }
        }

        if (diagnostics.length > 0) {
            lines.push('')
            lines.push('Diagnostics:')
            for (const d of diagnostics) lines.push(`  - ${d}`)
        }

        return { type: 'message', content: lines.join('\n') }
    },
}

export const skillCommand: SlashCommand = {
    name: 'skill',
    description: 'Invoke a skill or manage packages. Usage: /skill <name> [task] | install <url> | uninstall <name> | update [name]',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const trimmed = args.trim()
        if (!trimmed) {
            return {
                type: 'message',
                content: [
                    'Usage:',
                    '  /skill <name> [task]     — invoke a skill',
                    '  /skill install <url>     — install a skill package from a git URL',
                    '  /skill uninstall <name>  — remove an installed package',
                    '  /skill update [name]     — update one or all installed packages',
                ].join('\n'),
                isError: true,
            }
        }

        const [sub, ...rest] = trimmed.split(/\s+/)

        // --- install ---
        if (sub === 'install') {
            const url = rest.join(' ').trim()
            if (!url) return { type: 'message', content: 'Usage: /skill install <git-url>', isError: true }
            try {
                const pkg = await installPackage(url)
                return {
                    type: 'message',
                    content: `Installed '${pkg.name}' from ${pkg.url}\nSkills are available at: ${pkg.sourcePath}/${pkg.skillsDir}`,
                }
            } catch (err: any) {
                return { type: 'message', content: `Install failed: ${err.message}`, isError: true }
            }
        }

        // --- uninstall ---
        if (sub === 'uninstall') {
            const name = rest.join(' ').trim()
            if (!name) return { type: 'message', content: 'Usage: /skill uninstall <name>', isError: true }
            try {
                await uninstallPackage(name)
                return { type: 'message', content: `Uninstalled '${name}'.` }
            } catch (err: any) {
                return { type: 'message', content: `Uninstall failed: ${err.message}`, isError: true }
            }
        }

        // --- update ---
        if (sub === 'update') {
            const name = rest.join(' ').trim()
            try {
                if (name) {
                    await updatePackage(name)
                    return { type: 'message', content: `Updated '${name}'.` }
                }
                // Update all
                const registry = await readRegistry()
                if (registry.packages.length === 0) {
                    return { type: 'message', content: 'No installed packages to update.' }
                }
                const results: string[] = []
                for (const pkg of registry.packages) {
                    try {
                        await updatePackage(pkg.name)
                        results.push(`  ${pkg.name}  ok`)
                    } catch (e: any) {
                        results.push(`  ${pkg.name}  failed: ${e.message}`)
                    }
                }
                return { type: 'message', content: `Updated packages:\n${results.join('\n')}` }
            } catch (err: any) {
                return { type: 'message', content: `Update failed: ${err.message}`, isError: true }
            }
        }

        // --- invoke skill (default) ---
        const name = sub
        const task = rest.join(' ').trim()

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

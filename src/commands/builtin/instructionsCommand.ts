import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const instructionsCommand: SlashCommand = {
    name: 'instructions',
    description: 'Show loaded project instruction files',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
        const { client } = context

        if (!client) {
            return {
                type: 'message',
                content: 'Not connected to server.',
                isError: true,
            }
        }

        try {
            const result = await client.getInstructions()

            if (result.files.length === 0) {
                return {
                    type: 'message',
                    content: 'Project instructions: no files loaded.\n\nCreate ~/.lop/instructions.md for global instructions, or LOP.md in your project for project-specific instructions.',
                }
            }

            const lines = [
                `Project instructions: ${result.files.length} file(s) loaded`,
                '',
            ]

            for (const file of result.files) {
                lines.push(`  ${file.path.padEnd(40)} (${file.sizeFormatted})`)
            }

            lines.push('')
            lines.push(`Total: ${result.totalSizeFormatted} injected into system prompt.`)
            lines.push('Run /instructions to refresh after editing files.')

            return {
                type: 'message',
                content: lines.join('\n'),
            }
        } catch (error: any) {
            return {
                type: 'message',
                content: `Failed to load instructions: ${error.message}`,
                isError: true,
            }
        }
    },
}

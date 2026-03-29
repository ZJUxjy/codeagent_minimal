import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const btwCommand: SlashCommand = {
    name: 'btw',
    description: 'Ask a side question without affecting conversation history',
    kind: CommandKind.BUILT_IN,

    action: (_context: CommandContext, args: string): SlashCommandActionReturn => {
        if (!args.trim()) {
            return { type: 'message', content: 'Usage: /btw <question>' }
        }
        return { type: 'btw', question: args.trim() }
    },
}

import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const quitCommand: SlashCommand = {
    name: 'quit',
    altNames: ['exit', 'q', 'bye'],
    description: 'Exit the application',
    kind: CommandKind.BUILT_IN,

    action: (context: CommandContext, args: string): SlashCommandActionReturn => {
        return { type: 'quit' }
    },
}

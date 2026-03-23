import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

/** 格式化持续时间 */
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) {
        return `${hours}h ${minutes % 60}m ${seconds % 60}s`
    } else if (minutes > 0) {
        return `${minutes}m ${seconds % 60}s`
    } else {
        return `${seconds}s`
    }
}

export const statsCommand: SlashCommand = {
    name: 'stats',
    altNames: ['usage', 'info'],
    description: 'Show session statistics',
    kind: CommandKind.BUILT_IN,

    action: (context: CommandContext, args: string): SlashCommandActionReturn => {
        const { config } = context

        const lines = [
            '📊 Session Statistics',
            '',
            `Provider: ${config.provider ?? 'default'}`,
            `Model: ${config.model ?? 'default'}`,
            `Working Directory: ${config.cwd}`,
            '',
            'Use /stats model for model details',
            'Use /stats tools for tool usage',
        ]

        return {
            type: 'message',
            content: lines.join('\n'),
        }
    },

    subCommands: [
        {
            name: 'model',
            description: 'Show current model information',
            kind: CommandKind.BUILT_IN,
            action: (context: CommandContext): SlashCommandActionReturn => {
                const { config } = context
                return {
                    type: 'message',
                    content: `Current Model: ${config.model ?? 'default'}\nProvider: ${config.provider ?? 'default'}`,
                }
            },
        },
        {
            name: 'tools',
            description: 'Show tool usage statistics',
            kind: CommandKind.BUILT_IN,
            action: (context: CommandContext): SlashCommandActionReturn => {
                // TODO: 实现工具使用统计
                return {
                    type: 'message',
                    content: 'Tool usage statistics will be available in a future version.',
                }
            },
        },
    ],
}

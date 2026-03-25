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
                const stats = context.getToolStats()

                if (stats.size === 0) {
                    return {
                        type: 'message',
                        content: '📊 Tool Usage Statistics\n\nNo tool calls in this session.',
                    }
                }

                // 计算总计
                let totalCalls = 0
                let totalSuccess = 0
                let totalFailed = 0
                let totalTime = 0

                const entries: Array<{ name: string; calls: number; success: number; failed: number; avgTime: number }> = []

                stats.forEach((entry) => {
                    totalCalls += entry.calls
                    totalSuccess += entry.success
                    totalFailed += entry.failed
                    totalTime += entry.totalTime

                    entries.push({
                        name: entry.name,
                        calls: entry.calls,
                        success: entry.success,
                        failed: entry.failed,
                        avgTime: Math.round(entry.totalTime / entry.calls),
                    })
                })

                // 按调用次数排序
                entries.sort((a, b) => b.calls - a.calls)

                // 构建表格
                const lines = [
                    '📊 Tool Usage Statistics',
                    '',
                    'Tool          Calls  Success  Failed  Avg Time',
                    '─'.repeat(44),
                ]

                for (const entry of entries) {
                    lines.push(
                        `${entry.name.padEnd(12)} ${String(entry.calls).padStart(5)}  ${String(entry.success).padStart(7)}  ${String(entry.failed).padStart(6)}  ${String(entry.avgTime).padStart(8)}ms`
                    )
                }

                lines.push('─'.repeat(44))
                lines.push(
                    `${'Total'.padEnd(12)} ${String(totalCalls).padStart(5)}  ${String(totalSuccess).padStart(7)}  ${String(totalFailed).padStart(6)}  ${String(Math.round(totalTime / totalCalls)).padStart(8)}ms`
                )

                return {
                    type: 'message',
                    content: lines.join('\n'),
                }
            },
        },
    ]
}

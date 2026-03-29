import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
    return String(n)
}

function bar(used: number, total: number, width = 20): string {
    const ratio = total > 0 ? Math.min(used / total, 1) : 0
    const filled = Math.round(ratio * width)
    return '[' + '#'.repeat(filled) + '-'.repeat(width - filled) + ']'
}

async function showDetailed(context: CommandContext): Promise<SlashCommandActionReturn> {
    const usage = context.getTokenUsage()

    if (usage.totalTokens === 0) {
        return {
            type: 'message',
            content: '📊 Context Usage\n\nNo token data available yet. Usage tracking starts after the first API call.',
        }
    }

    // Try to get detailed breakdown from server
    let serverInfo: Record<string, number> | null = null
    if (context.client) {
        try {
            serverInfo = await context.client.contextInfo()
        } catch {
            // Server doesn't support it yet, that's fine
        }
    }

    const lines = [
        '📊 Context Window Usage',
        '',
    ]

    if (serverInfo) {
        const si = serverInfo
        const maxCtx = si.maxContextTokens || 100_000
        const used = (si.messageTokens || 0) + (si.toolDefTokens || 0) + (si.systemTokens || 0)
        const free = si.estimatedContextFree || Math.max(0, maxCtx - used)
        const pct = Math.round((used / maxCtx) * 100)

        lines.push(`  ${bar(used, maxCtx)} ${pct}%`)
        lines.push('')
        lines.push(`  System prompt:    ${formatTokens(si.systemTokens || 0).padStart(8)} tokens`)
        lines.push(`  Tool definitions: ${formatTokens(si.toolDefTokens || 0).padStart(8)} tokens`)
        lines.push(`  Messages:         ${formatTokens(si.messageTokens || 0).padStart(8)} tokens (${si.messageCount || 0} messages)`)
        lines.push(`  Free space:       ${formatTokens(free).padStart(8)} tokens`)
        lines.push(`  Context limit:    ${formatTokens(maxCtx).padStart(8)} tokens`)
        lines.push('')
    }

    lines.push('  Session Totals:')
    lines.push(`    Prompt tokens:     ${formatTokens(usage.promptTokens)}`)
    lines.push(`    Completion tokens: ${formatTokens(usage.completionTokens)}`)
    lines.push(`    Total tokens:      ${formatTokens(usage.totalTokens)}`)

    return { type: 'message', content: lines.join('\n') }
}

function showSummary(context: CommandContext): SlashCommandActionReturn {
    const usage = context.getTokenUsage()

    if (usage.totalTokens === 0) {
        return {
            type: 'message',
            content: '📊 Token Usage\n\nNo token data yet. Make a request first.',
        }
    }

    return {
        type: 'message',
        content: [
            '📊 Token Usage (Session)',
            '',
            `  Prompt: ${formatTokens(usage.promptTokens)}  Completion: ${formatTokens(usage.completionTokens)}  Total: ${formatTokens(usage.totalTokens)}`,
            '',
            'Use /context detail for full breakdown',
        ].join('\n'),
    }
}

export const contextCommand: SlashCommand = {
    name: 'context',
    description: 'Show context window usage and token statistics',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const sub = args.trim().toLowerCase()

        if (sub === 'detail' || sub === 'd') {
            return showDetailed(context)
        }

        return showSummary(context)
    },

    subCommands: [
        {
            name: 'detail',
            altNames: ['d'],
            description: 'Show detailed context breakdown with per-category tokens',
            kind: CommandKind.BUILT_IN,
            action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
                return showDetailed(context)
            },
        },
    ],
}

import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

/**
 * 格式化命令帮助信息
 */
function formatCommandHelp(commands: SlashCommand[]): string {
    const lines: string[] = [
        '╭──────────────────────────────────────╮',
        '│           Available Commands          │',
        '╰──────────────────────────────────────╯',
        '',
    ]

    // 过滤出可见命令并排序
    const visibleCommands = commands
        .filter(cmd => !cmd.hidden)
        .sort((a, b) => a.name.localeCompare(b.name))

    for (const cmd of visibleCommands) {
        // 主命令行
        let line = `  /${cmd.name}`

        // 添加别名
        if (cmd.altNames && cmd.altNames.length > 0) {
            line += ` (${cmd.altNames.join(', ')})`
        }

        lines.push(line)

        // 添加描述（缩进）
        if (cmd.description) {
            lines.push(`      ${cmd.description}`)
        }

        // 添加子命令
        if (cmd.subCommands && cmd.subCommands.length > 0) {
            for (const subCmd of cmd.subCommands) {
                if (subCmd.hidden) continue
                lines.push(`    /${cmd.name} ${subCmd.name} - ${subCmd.description ?? ''}`)
            }
        }

        lines.push('')  // 空行分隔
    }

    lines.push('───────────────────────────────────────')
    lines.push('')
    lines.push('Keyboard Shortcuts:')
    lines.push('  Ctrl+C  - Quit')
    lines.push('  Ctrl+L  - Clear screen')
    lines.push('  ↑/↓     - Navigate history')
    lines.push('  Tab     - Accept suggestion')
    lines.push('')
    lines.push('Type a message to chat with the AI.')

    return lines.join('\n')
}

export const helpCommand: SlashCommand = {
    name: 'help',
    altNames: ['?', '？', 'h'],
    description: 'Show available commands and help',
    kind: CommandKind.BUILT_IN,

    action: (context: CommandContext, args: string): SlashCommandActionReturn => {
        // 获取所有可见命令
        const commands = context.getVisibleCommands()
        const helpText = formatCommandHelp(commands)

        return {
            type: 'message',
            content: helpText,
        }
    },
}

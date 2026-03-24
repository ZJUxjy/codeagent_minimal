// 内置命令索引
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { themeCommand } from './themeCommand.js'
export { mcpCommand } from './mcpCommand.js'

// 所有内置命令列表
import { helpCommand } from './helpCommand.js'
import { clearCommand } from './clearCommand.js'
import { quitCommand } from './quitCommand.js'
import { statsCommand } from './statsCommand.js'
import { themeCommand } from './themeCommand.js'
import { mcpCommand } from './mcpCommand.js'
import type { SlashCommand } from '../types.js'

export const allBuiltinCommands: SlashCommand[] = [
    helpCommand,
    clearCommand,
    quitCommand,
    statsCommand,
    themeCommand,
    mcpCommand,
]

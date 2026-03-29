// 内置命令索引
export { helpCommand } from './helpCommand.js'
export { clearCommand } from './clearCommand.js'
export { quitCommand } from './quitCommand.js'
export { statsCommand } from './statsCommand.js'
export { themeCommand } from './themeCommand.js'
export { mcpCommand } from './mcpCommand.js'
export { sessionsCommand } from './sessionsCommand.js'
export { loadCommand } from './loadCommand.js'
export { deleteCommand } from './deleteCommand.js'
export { renameCommand } from './renameCommand.js'
export { skillsCommand, skillCommand } from './skillCommand.js'
export { approvalModeCommand } from './approvalModeCommand.js'
export { instructionsCommand } from './instructionsCommand.js'
export { compressCommand } from './compressCommand.js'
export { btwCommand } from './btwCommand.js'

// 所有内置命令列表
import { helpCommand } from './helpCommand.js'
import { clearCommand } from './clearCommand.js'
import { quitCommand } from './quitCommand.js'
import { statsCommand } from './statsCommand.js'
import { themeCommand } from './themeCommand.js'
import { mcpCommand } from './mcpCommand.js'
import { sessionsCommand } from './sessionsCommand.js'
import { loadCommand } from './loadCommand.js'
import { deleteCommand } from './deleteCommand.js'
import { renameCommand } from './renameCommand.js'
import { skillsCommand, skillCommand } from './skillCommand.js'
import { approvalModeCommand } from './approvalModeCommand.js'
import { instructionsCommand } from './instructionsCommand.js'
import { compressCommand } from './compressCommand.js'
import { btwCommand } from './btwCommand.js'
import type { SlashCommand } from '../types.js'

export const allBuiltinCommands: SlashCommand[] = [
    helpCommand,
    clearCommand,
    quitCommand,
    statsCommand,
    themeCommand,
    mcpCommand,
    sessionsCommand,
    loadCommand,
    deleteCommand,
    renameCommand,
    skillsCommand,
    skillCommand,
    approvalModeCommand,
    instructionsCommand,
    compressCommand,
    btwCommand,
]

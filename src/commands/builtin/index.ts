// Built-in command index
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
import { contextCommand } from './contextCommand.js'
import { planCommand } from './planCommand.js'
import type { SlashCommand } from '../types.js'

export {
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
    contextCommand,
    planCommand,
}

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
    contextCommand,
    planCommand,
]

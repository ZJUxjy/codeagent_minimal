import type { SlashCommand } from '../types.js'
import { allBuiltinCommands } from '../builtin/index.js'

/**
 * 命令加载器接口
 */
export interface ICommandLoader {
    /** 加载命令 */
    loadCommands(): Promise<SlashCommand[]> | SlashCommand[]
}

/**
 * 内置命令加载器
 *
 * 加载所有内置的 slash 命令
 */
export class BuiltinCommandLoader implements ICommandLoader {
    /**
     * 加载内置命令
     */
    loadCommands(): SlashCommand[] {
        return allBuiltinCommands
    }
}

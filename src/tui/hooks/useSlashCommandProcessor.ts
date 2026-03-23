import { useMemo, useCallback } from 'react'
import { CommandRegistry } from '../../commands/CommandRegistry.js'
import { BuiltinCommandLoader } from '../../commands/loaders/BuiltinCommandLoader.js'
import { parseCommand, isCommand } from '../utils/commandParser.js'
import type { Client } from '../../client/index.js'
import type { LopConfig } from '../../protocol/types.js'
import type { Message } from '../types.js'
import type { CommandContext, SlashCommandActionReturn } from '../../commands/types.js'

/**
 * Hook 选项
 */
export interface UseSlashCommandProcessorOptions {
    /** 客户端实例 */
    client: Client | null

    /** 配置信息 */
    config: LopConfig & { cwd: string }

    /** UI 操作 */
    ui: {
        /** 添加消息 */
        addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void
        /** 添加系统消息 */
        addSystemMessage: (content: string, isError?: boolean) => void
        /** 清空消息 */
        clearMessages: () => void
        /** 设置加载状态 */
        setLoading: (loading: boolean) => void
    }

    /** 退出应用 */
    quit: () => void
}

/**
 * 处理结果
 */
export type ProcessResult =
    | { type: 'handled' }
    | { type: 'submit_prompt'; content: string }
    | { type: 'quit' }

/**
 * Hook 返回值
 */
export interface UseSlashCommandProcessorReturn {
    /** 命令注册表 */
    registry: CommandRegistry

    /** 处理用户输入 */
    processInput: (input: string) => Promise<ProcessResult>
}

/**
 * Slash 命令处理 Hook
 *
 * 负责解析和执行 slash 命令
 */
export function useSlashCommandProcessor(
    options: UseSlashCommandProcessorOptions
): UseSlashCommandProcessorReturn {
    const { client, config, ui, quit } = options

    // 1. 创建命令注册表（只执行一次）
    const registry = useMemo(() => {
        const loader = new BuiltinCommandLoader()
        const commands = loader.loadCommands()
        return new CommandRegistry(commands)
    }, [])

    // 2. 处理输入
    const processInput = useCallback(async (input: string): Promise<ProcessResult> => {
        const trimmed = input.trim()

        // 空输入
        if (!trimmed) {
            return { type: 'handled' }
        }

        // 检查是否是命令
        if (!isCommand(trimmed)) {
            // 不是命令，作为普通消息提交
            return { type: 'submit_prompt', content: trimmed }
        }

        // 解析命令
        const { command, args } = parseCommand(trimmed, registry)

        // 命令未找到
        if (!command) {
            const cmdName = trimmed.split(/\s+/)[0] ?? trimmed
            ui.addSystemMessage(`Unknown command: ${cmdName}. Type /help for available commands.`, true)
            return { type: 'handled' }
        }

        // 构建命令上下文
        const context: CommandContext = {
            client,
            config,
            ui,
            getVisibleCommands: () => registry.getVisibleCommands(),
            quit,
        }

        try {
            // 执行命令
            const result: SlashCommandActionReturn = command.action
                ? await command.action(context, args)
                : undefined

            // 处理返回结果
            return handleCommandResult(result, ui)
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            ui.addSystemMessage(`Command error: ${errorMessage}`, true)
            return { type: 'handled' }
        }
    }, [client, config, ui, quit, registry])

    return {
        registry,
        processInput,
    }
}

/**
 * 处理命令返回结果
 */
function handleCommandResult(
    result: SlashCommandActionReturn,
    ui: UseSlashCommandProcessorOptions['ui']
): ProcessResult {
    // void 返回
    if (!result) {
        return { type: 'handled' }
    }

    switch (result.type) {
        case 'message':
            ui.addSystemMessage(result.content, result.isError)
            return { type: 'handled' }

        case 'quit':
            return { type: 'quit' }

        case 'submit_prompt':
            return { type: 'submit_prompt', content: result.content }

        default:
            return { type: 'handled' }
    }
}

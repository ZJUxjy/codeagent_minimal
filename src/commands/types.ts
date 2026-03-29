import type { Client } from '../client/index.js'
import type { TokenUsage } from '../llm.js'
import type { LopConfig } from '../protocol/types.js'
import type { Message, ToolStats } from '../tui/types.js'

/** 命令类型 */
export enum CommandKind {
    BUILT_IN = 'built-in',
    SKILL = 'skill',
}

/** 命令上下文 - 传递给命令的上下文 */
export interface CommandContext {
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

    /** 获取所有可见命令（用于 help 命令） */
    getVisibleCommands: () => SlashCommand[]

    /** 获取工具使用统计 */
    getToolStats: () => ToolStats

    /** 获取 token 使用统计 */
    getTokenUsage: () => TokenUsage

    /** 退出应用 */
    quit: () => void

    /**
     * 终端主题（内置 palette 切换）
     * 由 TUI App 注入，供 /theme 等命令使用
     */
    theme: {
        /** 当前主题 id，如 dark */
        currentId: string
        /** 应用主题；非法 id 返回 false */
        applyTheme: (rawId: string) => boolean
        /** 可切换的内置主题 */
        listBuiltins: () => Array<{ id: string; displayName: string }>
    }
}

/** 命令返回类型 */
export type SlashCommandActionReturn =
    | { type: 'message'; content: string; isError?: boolean }
    | { type: 'quit' }
    | { type: 'submit_prompt'; content: string }
    | { type: 'btw'; question: string }
    | void

/** Slash 命令接口 */
export interface SlashCommand {
    /** 命令名称 */
    name: string

    /** 别名 */
    altNames?: string[]

    /** 描述 */
    description: string

    /** 是否隐藏（不在帮助中显示） */
    hidden?: boolean

    /** 命令类型 */
    kind: CommandKind

    /** 命令执行动作 */
    action?: (
        context: CommandContext,
        args: string
    ) => SlashCommandActionReturn | Promise<SlashCommandActionReturn>

    /** 子命令 */
    subCommands?: SlashCommand[]
}

import type { CommandRegistry } from "../../commands/CommandRegistry.js";
import type { SlashCommand } from "../../commands/types.js";

/** 解析后的命令结果 */
export interface ParsedCommand {
    /** 找到的命令 */
    command: SlashCommand | undefined
    /** 命令参数 */
    args: string
    /** 命令路径（如 ['stats', 'model']） */
    path: string[]
}

/**
 * 解析斜杠命令输入
 *
 * @param input - 用户输入，如 "/help" 或 "/stats model --verbose"
 * @param registry - 命令注册表
 * @returns 解析结果
 */
export function parseCommand(
    input: string,
    registry: CommandRegistry
): ParsedCommand {
    // 去掉开头的 /
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
        return { command: undefined, args: '', path: [] };
    }

    const content = trimmed.slice(1).trim();

    // 分割成部分
    const parts = content.split(/\s+/);
    if (parts.length === 0 || parts[0] === '') {
        return { command: undefined, args: '', path: [] };
    }

    // 遍历查找命令（支持子命令）
    let currentCommand: SlashCommand | undefined;
    let currentCommands = registry.getAllCommands();
    const path: string[] = [];
    let consumedIndex = 0;

    for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (part === '') continue;

        // 查找匹配的命令
        const found = currentCommands.find(cmd =>
            cmd.name === part || cmd.altNames?.includes(part)
        );

        if (found) {
            currentCommand = found;
            path.push(found.name);
            consumedIndex = i + 1;

            // 如果有子命令，继续查找
            if (found.subCommands && found.subCommands.length > 0) {
                currentCommands = found.subCommands;
            } else {
                // 没有子命令，停止查找
                break;
            }
        } else {
            // 没找到，剩余部分作为参数
            break;
        }
    }

    // 剩余部分作为参数
    const args = parts.slice(consumedIndex).join(' ');

    return {
        command: currentCommand,
        args,
        path,
    };
}

/**
 * 检查输入是否是命令
 */
export function isCommand(input: string): boolean {
    const trimmed = input.trim();
    return trimmed.startsWith('/');
}

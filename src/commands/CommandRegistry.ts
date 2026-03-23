import type { SlashCommand } from "./types.js";

/**
 * 命令注册表 - 管理所有 slash 命令
 */
export class CommandRegistry {
    private commands: Map<string, SlashCommand> = new Map();
    private aliasMap: Map<string, string> = new Map();

    constructor(commands: SlashCommand[]) {
        // 注册所有命令
        for (const cmd of commands) {
            this.register(cmd);
        }
    }

    /**
     * 注册单个命令
     */
    private register(command: SlashCommand): void {
        // 注册主名称
        this.commands.set(command.name, command);

        // 注册别名
        if (command.altNames) {
            for (const altName of command.altNames) {
                this.aliasMap.set(altName, command.name);
            }
        }

        // 递归注册子命令（如果有）
        if (command.subCommands) {
            for (const subCmd of command.subCommands) {
                this.register(subCmd);
            }
        }
    }

    /**
     * 根据名称或别名查找命令
     */
    find(name: string): SlashCommand | undefined {
        // 先查找主名称
        const cmd = this.commands.get(name);
        if (cmd) return cmd;

        // 再查找别名
        const mainName = this.aliasMap.get(name);
        if (mainName) {
            return this.commands.get(mainName);
        }

        return undefined;
    }

    /**
     * 获取所有可见命令（非隐藏）
     */
    getVisibleCommands(): SlashCommand[] {
        return this.getAllCommands().filter(cmd => !cmd.hidden);
    }

    /**
     * 获取所有命令
     */
    getAllCommands(): SlashCommand[] {
        // 使用 Set 去重（因为子命令可能被重复注册）
        const seen = new Set<string>();
        const result: SlashCommand[] = [];

        for (const cmd of this.commands.values()) {
            if (!seen.has(cmd.name)) {
                seen.add(cmd.name);
                result.push(cmd);
            }
        }

        return result;
    }
}

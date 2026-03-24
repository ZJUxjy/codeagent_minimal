import { existsSync, readFileSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import type { LopConfig } from "./protocol/types.js"
import { parseMcpConfig } from "./server/mcp/config.js"

const CONFIG_FILES = [
    "config.json",
    "lop.config.json",
    ".lop.config.json",
]

/** 标准化配置（统一命名） */
function normalizeConfig(config: any): LopConfig {
    const parsed = parseMcpConfig(config)
    return {
        provider: config.provider,
        model: config.model,
        // 兼容 token/apiKey 两种命名
        apiKey: config.apiKey ?? config.token,
        // 兼容 url/baseURL 两种命名
        baseURL: config.baseURL ?? config.url,
        debug: config.debug ?? false,
        // MCP 配置
        mcpServers: parsed.mcpServers,
        mcp: parsed.mcp,
    }
}

/** 从指定目录开始查找配置文件 */
export function loadConfig(startDir: string = process.cwd()): LopConfig {
    // 从当前目录向上查找
    let dir = startDir
    const root = dirname(dir)

    while (true) {
        for (const file of CONFIG_FILES) {
            const path = join(dir, file)
            if (existsSync(path)) {
                try {
                    const content = readFileSync(path, "utf-8")
                    const config = JSON.parse(content)
                    console.log(`Loaded config from ${path}`)
                    return normalizeConfig(config)
                } catch (error: any) {
                    console.warn(`Failed to load config from ${path}:`, error)
                }
            }
        }

        if (dir === root) break
        dir = dirname(dir)
    }

    // 检查用户主目录
    for (const file of CONFIG_FILES) {
        const path = join(homedir(), file)
        if (existsSync(path)) {
            try {
                const content = readFileSync(path, "utf-8")
                const config = JSON.parse(content)
                console.log(`Loaded config from ${path}`)
                return normalizeConfig(config)
            } catch (error: any) {
                console.warn(`Failed to load config from ${path}:`, error)
            }
        }
    }

    return {}
}

export function mergeConfig(options: {
    cli?: Partial<LopConfig>
    env?: Partial<LopConfig>
    file?: Partial<LopConfig>
}): LopConfig {
    return {
        provider: options.cli?.provider ?? options.env?.provider ?? options.file?.provider,
        model: options.cli?.model ?? options.env?.model ?? options.file?.model,
        apiKey: options.cli?.apiKey ?? options.env?.apiKey ?? options.file?.apiKey,
        baseURL: options.cli?.baseURL ?? options.env?.baseURL ?? options.file?.baseURL,
        debug: options.cli?.debug ?? options.env?.debug ?? options.file?.debug,
        mcpServers: options.file?.mcpServers,
        mcp: options.file?.mcp,
    }
}

/** 全局调试开关 */
let _debugEnabled = false

/** 设置调试开关 */
export function setDebug(enabled: boolean): void {
    _debugEnabled = enabled
}

/** 调试日志 */
export function debugLog(...args: unknown[]): void {
    if (_debugEnabled) {
        console.error("[Debug]", ...args)
    }
}

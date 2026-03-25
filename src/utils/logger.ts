import { appendFileSync, mkdirSync, existsSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'


export const enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
}

export interface LoggerConfig {
    file: string
    level: LogLevel
    enabled?: boolean
}

class DisabledLogger {
    debug(_tag: string, _message: string, ..._args: unknown[]): void { }
    info(_tag: string, _message: string, ..._args: unknown[]): void { }
    warn(_tag: string, _message: string, ..._args: unknown[]): void { }
    error(_tag: string, _message: string, ..._args: unknown[]): void { }
}

export class Logger {
    private file: string
    private level: LogLevel
    private enabled: boolean

    constructor(config: LoggerConfig) {
        this.file = config.file
        this.level = config.level
        this.enabled = config.enabled ?? true

        if (this.enabled) {
            const dir = dirname(this.file)
            if (!existsSync(dir)) {
                mkdirSync(dir, { recursive: true })
            }
        }
    }

    private formatMessage(level: string, tag: string, message: string, args: unknown[]): string {
        const timestamp = new Date().toISOString()
        const argsStr = args.length > 0 ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : ''
        return `${timestamp} [${level}] [${tag}] ${message}${argsStr}\n`
    }

    private log(level: LogLevel, levelName: string, tag: string, message: string, args: unknown[]): void {
        if (!this.enabled || level < this.level) {
            return
        }

        const formatted = this.formatMessage(levelName, tag, message, args)
        try {
            appendFileSync(this.file, formatted, 'utf-8')
        } catch { }
    }

    debug(tag: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.DEBUG, 'DEBUG', tag, message, args)
    }

    info(tag: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.INFO, 'INFO', tag, message, args)
    }

    warn(tag: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.WARN, 'WARN', tag, message, args)
    }

    error(tag: string, message: string, ...args: unknown[]): void {
        this.log(LogLevel.ERROR, 'ERROR', tag, message, args)
    }
}

/** 全局 Logger 实例 */
let globalLogger: Logger | DisabledLogger = new DisabledLogger()

/** 设置全局 Logger */
export function setGlobalLogger(logger: Logger): void {
    globalLogger = logger
}

export function getGlobalLogger(): Logger | DisabledLogger {
    return globalLogger
}

export function debug(tag: string, message: string, ...args: unknown[]): void {
    globalLogger.debug(tag, message, ...args)
}

export function info(tag: string, message: string, ...args: unknown[]): void {
    globalLogger.info(tag, message, ...args)
}

export function warn(tag: string, message: string, ...args: unknown[]): void {
    globalLogger.warn(tag, message, ...args)
}

export function error(tag: string, message: string, ...args: unknown[]): void {
    globalLogger.error(tag, message, ...args)
}

function parseLogLevel(level: string | undefined): LogLevel {
    switch (level?.toUpperCase()) {
        case 'DEBUG':
            return LogLevel.DEBUG
        case 'INFO':
            return LogLevel.INFO
        case 'WARN':
        case 'WARNING':
            return LogLevel.WARN
        case 'ERROR':
            return LogLevel.ERROR
        default:
            return LogLevel.DEBUG
    }
}

/**
 * 创建并设置全局 Logger
 * @param logDir 日志目录，默认 ~/.lop/debug
 * @param sessionId 会话 ID，默认自动生成
 */
export function createLogger(logDir?: string, sessionId?: string): Logger | DisabledLogger {
    // 检查环境变量是否启用
    const enabled = process.env.LOP_DEBUG === '1' || process.env.LOP_DEBUG === 'true'

    if (!enabled) {
        return new DisabledLogger()
    }

    const dir = logDir ?? join(homedir(), '.lop', 'debug')
    const sid = sessionId ?? randomUUID()
    const logFile = join(dir, `${sid}.log`)

    const level = parseLogLevel(process.env.LOP_DEBUG_LEVEL)

    const logger = new Logger({
        file: logFile,
        level,
        enabled: true,
    })

    // 创建 latest 符号链接
    try {
        const latestLink = join(dir, 'latest.log')
        if (existsSync(latestLink)) {
            unlinkSync(latestLink)
        }
        symlinkSync(logFile, latestLink)
    } catch {
        // 忽略符号链接错误
    }

    setGlobalLogger(logger)
    return logger
}
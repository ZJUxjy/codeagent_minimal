# Debug Logger 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 lop_minimal 项目实现一个开发调试日志系统，输出到文件，不干扰 TUI 显示

**Architecture:** 参考 qwen-code 的 debugLogger 设计，创建一个基于文件的日志系统。日志输出到 `~/.lop/debug/<session-id>.log`，支持日志级别（DEBUG, INFO, WARN, ERROR），通过环境变量 `LOP_DEBUG` 控制开关。

**Tech Stack:** TypeScript, Node.js fs module, AsyncLocalStorage (用于传递 session 上下文)

---

## 文件结构

| 文件路径 | 职责 |
|---------|------|
| `src/utils/logger.ts` | **创建** - 日志系统核心实现 |
| `src/utils/logger.test.ts` | **创建** - 日志系统单元测试 |
| `src/config.ts` | **修改** - 移除旧的 debugLog，集成新 logger |
| `src/index.ts` | **修改** - 在入口初始化 logger |

---

## Task 1: 实现核心 Logger 类

**Files:**
- Create: `src/utils/logger.ts`
- Test: `src/utils/logger.test.ts`

### Step 1.1: 编写 Logger 类型定义和接口测试

- [ ] **创建测试文件并编写类型测试**

```typescript
// src/utils/logger.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { Logger, LogLevel, createLogger, setGlobalLogger, getGlobalLogger } from './logger.js'

describe('Logger', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'lop-logger-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    // 重置全局 logger
    setGlobalLogger(null as any)
  })

  describe('LogLevel', () => {
    it('should have correct log level ordering', () => {
      expect(LogLevel.DEBUG).toBe(0)
      expect(LogLevel.INFO).toBe(1)
      expect(LogLevel.WARN).toBe(2)
      expect(LogLevel.ERROR).toBe(3)
    })
  })

  describe('Logger class', () => {
    it('should create logger with file output', () => {
      const logFile = join(tempDir, 'test.log')
      const logger = new Logger({ file: logFile, level: LogLevel.DEBUG })
      expect(logger).toBeDefined()
    })

    it('should write log messages to file', () => {
      const logFile = join(tempDir, 'test.log')
      const logger = new Logger({ file: logFile, level: LogLevel.DEBUG })

      logger.info('test', 'Hello World')

      const content = readFileSync(logFile, 'utf-8')
      expect(content).toContain('[INFO]')
      expect(content).toContain('[test]')
      expect(content).toContain('Hello World')
    })

    it('should respect log level filtering', () => {
      const logFile = join(tempDir, 'test.log')
      const logger = new Logger({ file: logFile, level: LogLevel.WARN })

      logger.debug('test', 'debug message')
      logger.info('test', 'info message')
      logger.warn('test', 'warn message')
      logger.error('test', 'error message')

      const content = readFileSync(logFile, 'utf-8')
      expect(content).not.toContain('debug message')
      expect(content).not.toContain('info message')
      expect(content).toContain('warn message')
      expect(content).toContain('error message')
    })

    it('should format timestamp in ISO format', () => {
      const logFile = join(tempDir, 'test.log')
      const logger = new Logger({ file: logFile, level: LogLevel.DEBUG })

      logger.info('test', 'message')

      const content = readFileSync(logFile, 'utf-8')
      // ISO format: 2026-03-25T12:34:56.789Z
      expect(content).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
    })
  })

  describe('Global logger', () => {
    it('should set and get global logger', () => {
      const logFile = join(tempDir, 'global.log')
      const logger = new Logger({ file: logFile, level: LogLevel.DEBUG })

      setGlobalLogger(logger)
      expect(getGlobalLogger()).toBe(logger)
    })
  })

  describe('createLogger factory', () => {
    it('should create disabled logger when LOP_DEBUG is not set', () => {
      delete process.env.LOP_DEBUG
      const logger = createLogger(tempDir)
      // disabled logger should not throw
      expect(() => logger.debug('test', 'message')).not.toThrow()
    })
  })
})
```

- [ ] **运行测试确认失败**

Run: `npm test src/utils/logger.test.ts`
Expected: FAIL - Cannot find module './logger.js'

---

### Step 1.2: 实现 Logger 核心类

- [ ] **实现 Logger 类**

```typescript
// src/utils/logger.ts
import { appendFileSync, mkdirSync, existsSync, symlinkSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { homedir } from 'os'
import { randomUUID } from 'crypto'

/** 日志级别 */
export const enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/** Logger 配置 */
export interface LoggerConfig {
  /** 日志文件路径 */
  file: string
  /** 最小日志级别 */
  level: LogLevel
  /** 是否启用 */
  enabled?: boolean
}

/** 禁用的 Logger - 不执行任何操作 */
class DisabledLogger {
  debug(_tag: string, _message: string, ..._args: unknown[]): void {}
  info(_tag: string, _message: string, ..._args: unknown[]): void {}
  warn(_tag: string, _message: string, ..._args: unknown[]): void {}
  error(_tag: string, _message: string, ..._args: unknown[]): void {}
}

/** 文件 Logger 实现 */
export class Logger {
  private file: string
  private level: LogLevel
  private enabled: boolean

  constructor(config: LoggerConfig) {
    this.file = config.file
    this.level = config.level
    this.enabled = config.enabled ?? true

    if (this.enabled) {
      // 确保日志目录存在
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
    } catch {
      // 静默失败，避免日志写入错误影响主流程
    }
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

/** 获取全局 Logger */
export function getGlobalLogger(): Logger | DisabledLogger {
  return globalLogger
}

/** 便捷函数 - 使用全局 Logger */
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

/** 解析日志级别字符串 */
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
```

- [ ] **运行测试确认通过**

Run: `npm test src/utils/logger.test.ts`
Expected: PASS

---

## Task 2: 在入口初始化 Logger

**Files:**
- Modify: `src/index.ts`

### Step 2.1: 更新入口文件初始化 Logger

- [ ] **修改 src/index.ts**

```typescript
// 在文件顶部导入后添加
import { createLogger, Logger } from './utils/logger.js'

// 在 main 函数开始处添加（在 parseArgs 之后）
// 初始化调试日志
const logger = createLogger()
if (logger instanceof Logger) {
  logger.info('main', `lop_minimal starting, session: ${process.env.LOP_SESSION_ID || 'default'}`)
}
```

需要读取现有的 index.ts 内容进行修改。

- [ ] **运行测试确认应用正常启动**

Run: `npm run build && echo '{"jsonrpc":"2.0","method":"initialize","id":1}' | timeout 2 npm run start || true`
Expected: 应用正常启动，无报错

---

## Task 3: 替换旧的 debugLog 函数

**Files:**
- Modify: `src/config.ts`

### Step 3.1: 移除旧 debugLog，使用新 Logger

- [ ] **修改 src/config.ts**

移除旧的 `debugLog` 和 `setDebug` 函数，替换为使用新 Logger：

```typescript
// 删除这些行：
// let _debugEnabled = false
// export function setDebug(enabled: boolean): void { ... }
// export function debugLog(...args: unknown[]): void { ... }

// 添加导入
import * as logger from './utils/logger.js'

// 如果需要保留兼容的 debugLog 函数：
export function debugLog(...args: unknown[]): void {
  logger.debug('config', String(args[0] ?? ''), ...args.slice(1))
}
```

- [ ] **运行测试确认通过**

Run: `npm test`
Expected: PASS

---

## Task 4: 添加使用示例和文档

**Files:**
- Modify: `CLAUDE.md`

### Step 4.1: 更新 CLAUDE.md 添加日志使用说明

- [ ] **在 CLAUDE.md 中添加日志章节**

在 `## Development Commands` 后面添加：

```markdown
## Debug Logging

开发调试日志系统，输出到文件，不干扰 TUI。

### 启用调试日志

```bash
LOP_DEBUG=1 npm run dev
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LOP_DEBUG` | 启用调试日志 (1/true) | 未设置 |
| `LOP_DEBUG_LEVEL` | 日志级别 (DEBUG/INFO/WARN/ERROR) | DEBUG |

### 日志位置

- 日志目录: `~/.lop/debug/`
- 当前会话: `<session-id>.log`
- 最新日志: `latest.log` (符号链接)

### 使用方式

```typescript
import { debug, info, warn, error } from './utils/logger.js'

debug('tag', 'debug message', { extra: 'data' })
info('tag', 'info message')
warn('tag', 'warning message')
error('tag', 'error message')
```
```

---

## Task 5: 最终验证和提交

### Step 5.1: 运行完整测试

- [ ] **运行所有测试**

Run: `npm test`
Expected: PASS

### Step 5.2: 构建验证

- [ ] **构建项目**

Run: `npm run build`
Expected: 无错误

### Step 5.3: 手动验证日志功能

- [ ] **启用日志运行并检查输出**

Run: `LOP_DEBUG=1 npm run dev -- -h 2>/dev/null; ls -la ~/.lop/debug/`
Expected: 日志目录和文件已创建

- [ ] **查看日志内容**

Run: `cat ~/.lop/debug/latest.log`
Expected: 包含启动日志

### Step 5.4: 提交代码

- [ ] **Git commit**

```bash
git add src/utils/logger.ts src/utils/logger.test.ts src/index.ts src/config.ts CLAUDE.md
git commit -m "feat: add file-based debug logging system

- Add Logger class with DEBUG/INFO/WARN/ERROR levels
- Output to ~/.lop/debug/<session-id>.log
- Environment variable LOP_DEBUG to enable
- Replace old debugLog with new logger
- Add latest.log symlink for easy access"
```

---

## 设计说明

### 日志格式

```
2026-03-25T12:34:56.789Z [INFO] [tag] message {"extra":"data"}
```

### 为什么不用第三方库？

参考 qwen-code 的设计，使用 Node.js 原生 `fs` 模块足够满足需求：
- 无额外依赖
- 同步写入简单可靠
- 性能足够（开发调试用）

### 为什么用 DisabledLogger？

当日志未启用时，返回一个空实现的 Logger，避免到处检查 `if (logger)` 的样板代码。

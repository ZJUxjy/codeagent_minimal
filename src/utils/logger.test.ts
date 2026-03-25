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
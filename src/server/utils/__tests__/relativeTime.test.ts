import { describe, it, expect } from 'vitest'
import { formatRelativeTime } from '../relativeTime.js'

describe('formatRelativeTime', () => {
  it('should return "just now" for < 60 seconds', () => {
    expect(formatRelativeTime(new Date(Date.now() - 30000))).toBe('just now')
  })
  it('should return minutes format', () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 60 * 1000))).toBe('5m ago')
  })
  it('should return hours format', () => {
    expect(formatRelativeTime(new Date(Date.now() - 3 * 60 * 60 * 1000))).toBe('3h ago')
  })
  it('should return days format', () => {
    expect(formatRelativeTime(new Date(Date.now() - 5 * 24 * 60 * 60 * 1000))).toBe('5d ago')
  })
  it('should return date for > 30 days', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000)
    expect(formatRelativeTime(old)).toMatch(/\d{1,2}\/\d{1,2}\/\d{2,4}/)
  })
})

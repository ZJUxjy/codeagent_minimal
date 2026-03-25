import { describe, it, expect } from 'vitest';
import { getBaseDir, getSessionDir, getSessionFilePath, sanitizeCwd, generateSessionId, listSessionIds } from './storagePath.js';
import { homedir } from 'os';
import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('storagePath', () => {
  describe('getBaseDir', () => {
    it('should return .lop in home directory', () => {
      expect(getBaseDir()).toBe(join(homedir(), '.lop'));
    });
  });

  describe('sanitizeCwd', () => {
    it('should return 16-char hex string', () => {
      const result = sanitizeCwd('/home/user/project');
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be deterministic', () => {
      expect(sanitizeCwd('/home/user/project')).toBe(sanitizeCwd('/home/user/project'));
    });

    it('should differ for different paths', () => {
      expect(sanitizeCwd('/path/a')).not.toBe(sanitizeCwd('/path/b'));
    });
  });

  describe('getSessionDir', () => {
    it('should include sessions dir and project hash', () => {
      const dir = getSessionDir('/home/user/proj');
      expect(dir).toBe(join(homedir(), '.lop', 'sessions', sanitizeCwd('/home/user/proj')));
    });
  });

  describe('getSessionFilePath', () => {
    it('should return path ending with sessionId.jsonl', () => {
      const p = getSessionFilePath('/my/proj', 'abc123');
      expect(p).toMatch(/abc123\.jsonl$/);
    });
  });

  describe('generateSessionId', () => {
    it('should generate unique IDs', () => {
      expect(generateSessionId()).not.toBe(generateSessionId());
    });

    it('should be at least 8 chars', () => {
      expect(generateSessionId().length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('listSessionIds', () => {
    it('should return empty array for non-existent dir', () => {
      expect(listSessionIds('/nonexistent/dir')).toEqual([]);
    });

    it('should list .jsonl filenames without extension', () => {
      const dir = mkdtempSync(join(tmpdir(), 'sp-test-'));
      try {
        writeFileSync(join(dir, 'sess1.jsonl'), '');
        writeFileSync(join(dir, 'sess2.jsonl'), '');
        writeFileSync(join(dir, 'other.txt'), '');
        const ids = listSessionIds(dir);
        expect(ids).toContain('sess1');
        expect(ids).toContain('sess2');
        expect(ids).not.toContain('other');
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  });
});

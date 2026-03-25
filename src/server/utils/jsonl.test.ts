import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeLineSync, readLinesSync } from './jsonl.js';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('jsonl', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jsonl-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should write a single record to file', () => {
    const filePath = join(tempDir, 'test.jsonl');
    const record = { id: 1, message: 'hello' };

    writeLineSync(filePath, record);

    const content = readFileSync(filePath, 'utf-8');
    expect(content.trim()).toBe(JSON.stringify(record));
  });

  it('should append multiple records to same file', () => {
    const filePath = join(tempDir, 'test.jsonl');
    const record1 = { id: 1, message: 'first' };
    const record2 = { id: 2, message: 'second' };

    writeLineSync(filePath, record1);
    writeLineSync(filePath, record2);

    const lines = readLinesSync(filePath);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual(record1);
    expect(lines[1]).toEqual(record2);
  });

  it('should read empty file as empty array', () => {
    const filePath = join(tempDir, 'empty.jsonl');
    const lines = readLinesSync(filePath);
    expect(lines).toEqual([]);
  });
});

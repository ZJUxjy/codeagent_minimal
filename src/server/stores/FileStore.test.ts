import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from './FileStore.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('FileStore', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'filestore-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should add and retrieve messages', () => {
    const store = new FileStore('s1', '/test/cwd', tempDir);
    store.add({ role: 'user', content: 'Hello' });

    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].content).toBe('Hello');
  });

  it('should persist messages across instances', () => {
    const store1 = new FileStore('s1', '/test/cwd', tempDir);
    store1.add({ role: 'user', content: 'Hello' });
    store1.add({ role: 'assistant', content: 'Hi!' });

    const store2 = new FileStore('s1', '/test/cwd', tempDir);
    expect(store2.getAll()).toHaveLength(2);
    expect(store2.getAll()[0].content).toBe('Hello');
  });

  it('should clear messages in memory and on disk', () => {
    const store1 = new FileStore('s1', '/test/cwd', tempDir);
    store1.add({ role: 'user', content: 'Hello' });
    store1.clear();

    expect(store1.getAll()).toHaveLength(0);

    // 新实例读同一文件也应为空
    const store2 = new FileStore('s1', '/test/cwd', tempDir);
    expect(store2.getAll()).toHaveLength(0);
  });

  it('should list sessions in sessionDir', () => {
    const store = new FileStore('my-session', '/test/cwd', tempDir);
    store.add({ role: 'user', content: 'Hi' });

    const sessions = FileStore.listSessions('/test/cwd', tempDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('my-session');
    expect(sessions[0].messageCount).toBe(1);
    expect(sessions[0].preview).toBe('Hi');
  });

  it('getSessionId should return the session id', () => {
    const store = new FileStore('test-id', '/test/cwd', tempDir);
    expect(store.getSessionId()).toBe('test-id');
  });
});

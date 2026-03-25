import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStore } from '../server/stores/FileStore.js';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('Persistence Integration', () => {
  let tempDir: string;
  const cwd = '/test/project/path';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'persist-int-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true });
  });

  it('should persist and restore full conversation', () => {
    const store1 = new FileStore('session-a', cwd, tempDir);
    store1.add({ role: 'user', content: 'Hello AI' });
    store1.add({ role: 'assistant', content: 'Hello! How can I help?' });
    store1.add({ role: 'user', content: 'What is the weather?' });

    const store2 = new FileStore('session-a', cwd, tempDir);
    const messages = store2.getAll();
    expect(messages).toHaveLength(3);
    expect(messages[0].content).toBe('Hello AI');
    expect(messages[1].content).toBe('Hello! How can I help?');
    expect(messages[2].content).toBe('What is the weather?');
  });

  it('should list sessions sorted by mtime descending', async () => {
    const store1 = new FileStore('session-first', cwd, tempDir);
    store1.add({ role: 'user', content: 'First session' });

    // 等待 2ms 保证 mtime 不同
    await new Promise(r => setTimeout(r, 2));

    const store2 = new FileStore('session-second', cwd, tempDir);
    store2.add({ role: 'user', content: 'Second session' });

    const sessions = FileStore.listSessions(cwd, tempDir);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('session-second');
    expect(sessions[1].sessionId).toBe('session-first');
  });

  it('clear should remove messages from disk', () => {
    const store = new FileStore('session-b', cwd, tempDir);
    store.add({ role: 'user', content: 'Before clear' });
    store.clear();

    const reloaded = new FileStore('session-b', cwd, tempDir);
    expect(reloaded.getAll()).toHaveLength(0);
  });
});

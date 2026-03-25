import { createHash } from 'crypto';
import { existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const BASE_DIR_NAME = '.lop';
const SESSIONS_DIR_NAME = 'sessions';

/** 获取基础存储目录（~/.lop） */
export function getBaseDir(): string {
  return join(homedir(), BASE_DIR_NAME);
}

/** 将工作目录路径映射到 16 字符 hex 哈希 */
export function sanitizeCwd(cwd: string): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 16);
}

/** 获取指定项目的会话存储目录 */
export function getSessionDir(cwd: string): string {
  return join(getBaseDir(), SESSIONS_DIR_NAME, sanitizeCwd(cwd));
}

/** 获取会话 JSONL 文件完整路径 */
export function getSessionFilePath(cwd: string, sessionId: string): string {
  return join(getSessionDir(cwd), `${sessionId}.jsonl`);
}

/** 生成唯一会话 ID（时间戳+随机） */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 6);
  return `${timestamp}-${random}`;
}

/** 列出指定目录中的所有会话 ID（不含 .jsonl 后缀） */
export function listSessionIds(sessionDir: string): string[] {
  if (!existsSync(sessionDir)) return [];
  return readdirSync(sessionDir)
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.slice(0, -6));
}

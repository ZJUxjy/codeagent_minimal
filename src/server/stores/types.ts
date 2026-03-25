import type { CoreMessage } from 'ai';

/** 存储在 JSONL 文件中的一条会话记录 */
export interface SessionRecord {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_result';
  cwd: string;
  message: CoreMessage;
}

/** 供 /sessions 命令展示的会话摘要 */
export interface SessionInfo {
  sessionId: string;
  mtime: Date;
  messageCount: number;
  /** 第一条用户消息前 60 个字符 */
  preview?: string;
}

import type { CoreMessage } from 'ai';

/** 存储在 JSONL 文件中的一条会话记录 */
export interface SessionRecord {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant' | 'tool_result' | 'meta';
  cwd: string;
  message: CoreMessage | null;
  meta?: { provider: string; model: string };
}

/** SessionIndex 存储格式（index.json 中每个 session 的元数据） */
export interface SessionMeta {
  sessionId: string;
  title: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  preview: string | null;
  model?: string | null;
  provider?: string | null;
}

/** 供 /sessions 命令展示的会话摘要 */
export interface SessionInfo {
  sessionId: string;
  mtime: Date;
  messageCount: number;
  /** 第一条用户消息前 60 个字符 */
  preview?: string;
  /** 用户设置的会话标题 */
  title?: string;
  /** 会话开始时间（第一条记录的时间戳） */
  startTime?: string;
  /** 使用的模型 */
  model?: string;
  /** 使用的 provider */
  provider?: string;
}

export type MessageRole = "user" | "assistant" | "tool" | "thinking"

export interface BaseMessage {
    id: string;
    role: MessageRole;
    timestamp: number;
}

export interface UserMessage extends BaseMessage {
    role: "user";
    content: string;
}

export interface AssistantMessage extends BaseMessage {
    role: "assistant";
    content: string;
    isStreaming?: boolean;
}

export interface ToolCall {
    id: string;
    name: string;
    args: Record<string, unknown>;
    status: 'pending' | 'running' | 'success' | 'error';
    result?: string;
}

/** 单个工具的统计信息 */
export interface ToolStatEntry {
    name: string
    calls: number
    success: number
    failed: number
    totalTime: number  // 毫秒
}

/** 所有工具的统计 */
export type ToolStats = Map<string, ToolStatEntry>

/** 正在执行的工具调用（用于计时) */
export interface PendingToolCall {
    id: string
    name: string
    startTime: number
}

export interface ToolMessage extends BaseMessage {
    role: 'tool';
    toolCall: ToolCall;
}

export interface ThinkingMessage extends BaseMessage {
    role: "thinking";
    content: string;
    isStreaming?: boolean;
}

export type Message = UserMessage | AssistantMessage | ToolMessage | ThinkingMessage;

/** 一个对话回合：用户提问 + 所有后续回答（thinking/tool/assistant） */
export interface MessageTurn {
    id: string;
    messages: Message[];
}

/** 流式输出的瞬时状态（尚未提交到 messages 数组的内容） */
export interface StreamingState {
    content: string
    thinkingContent: string
    isThinkingStreaming: boolean
}

export interface AppState {
    messages: Message[];
    isLoading: boolean;
    loadingText?: string;

    inputValue: string;
    inputHistory: string[];
    historyIndex: number;

    model: string;
    provider: string;
    cwd: string;
}

export interface AppActions {
    addMessage: (message: Omit<Message, 'id' | 'timestamp'>) => void;
    updateMessage: (id: string, update: Partial<Message>) => void;

    setInputValue: (value: string) => void;
    submitInput: () => void;

    navigateHistory: (direction: 'up' | 'down') => void;

    clearMessages: () => void;
    setLoading: (loading: boolean, text?: string) => void;
}

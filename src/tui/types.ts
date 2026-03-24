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

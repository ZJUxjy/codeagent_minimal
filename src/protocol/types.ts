
import { z } from "zod"

// ============ JSON-RPC 2.0 基础类型 ============
/** JSON-RPC 请求 */
export interface JsonRpcRequest {
    jsonrpc: "2.0"
    id?: number | string
    method: string
    params?: unknown
}

/** JSON-RPC 响应 */
export interface JsonRpcResponse {
    jsonrpc: "2.0"
    id?: number | string
    result?: unknown
    error?: {
        code: number
        message: string
        data?: unknown
    }
}

/** JSON-RPC 通知 (不需要响应) */
export interface JsonRpcNotification {
    jsonrpc: "2.0"
    method: string
    params?: unknown
}

// ============ 请求参数类型 ============

/** initialize 方法参数 */
export const InitializeParamsSchema = z.object({
    clientInfo: z.object({
        name: z.string(),
        version: z.string().optional(),
    }).optional()
})

export type InitializeParams = z.infer<typeof InitializeParamsSchema>

/** chat 方法参数 */
export const ChatParamsSchema = z.object({
    message: z.string(),
    cwd: z.string().optional(),
})

export type ChatParams = z.infer<typeof ChatParamsSchema>

// ============ 通知类型 ============

/** 流式内容通知 */
export interface ContentNotification extends JsonRpcNotification {
    method: "content"
    params: {
        delta: string
    }
}

/** 思考内容通知 */
export interface ReasoningNotification extends JsonRpcNotification {
    method: "reasoning"
    params: {
        delta: string
    }
}

/** 思考内容结束通知 */
export interface ReasoningEndNotification extends JsonRpcNotification {
    method: "reasoning_end"
    params: {}
}

export interface ToolCallNotification extends JsonRpcNotification {
    method: "tool_call"
    params: {
        id: string
        name: string
        args: Record<string, unknown>
    }
}

/** 工具结果通知 */
export interface ToolResultNotification extends JsonRpcNotification {
    method: "tool_result"
    params: {
        id: string
        result: string
        isError?: boolean
    }
}

/** 完成通知 */
export interface DoneNotification extends JsonRpcNotification {
    method: "done"
    params: {
        finishReason: "stop" | "tool_calls" | "interrupted" | "error"
    }
}

// ============ Ask Question 类型 ============

/** 单个选项 */
export interface QuestionOption {
    label: string
    description?: string
}

/** 单个问题 */
export interface Question {
    id: string
    prompt: string
    options: QuestionOption[]
    allowMultiple?: boolean
}

/** ask_question 通知 (server → client) */
export interface AskQuestionNotification extends JsonRpcNotification {
    method: "ask_question"
    params: {
        requestId: string
        questions: Question[]
    }
}

/** ask_question_response 请求参数 (client → server) */
export const AskQuestionResponseParamsSchema = z.object({
    requestId: z.string(),
    answers: z.record(z.string(), z.string()).optional(),
    cancelled: z.boolean().optional(),
})

export type AskQuestionResponseParams = z.infer<typeof AskQuestionResponseParamsSchema>

// ============ Permission Request 类型 ============

/** permission_request 通知 (server → client) */
export interface PermissionRequestNotification extends JsonRpcNotification {
    method: "permission_request"
    params: {
        requestId: string
        toolName: string
        summary: string   // human-readable one-liner, e.g. "bash: rm -rf ./dist"
    }
}

/** permission_response 请求参数 (client → server) */
export const PermissionResponseParamsSchema = z.object({
    requestId: z.string(),
    outcome: z.enum(["allow", "always", "deny"]),
})

export type PermissionOutcome = "allow" | "always" | "deny"
export type PermissionResponseParams = z.infer<typeof PermissionResponseParamsSchema>

/** context_compressed 通知 */
export interface ContextCompressedNotification extends JsonRpcNotification {
    method: "context_compressed"
    params: { tokensBefore: number; tokensAfter: number }
}

/** 所有通知类型的联合 */
export type ServerNotification =
    | ContentNotification
    | ReasoningNotification
    | ReasoningEndNotification
    | ToolCallNotification
    | ToolResultNotification
    | DoneNotification
    | AskQuestionNotification
    | PermissionRequestNotification
    | ContextCompressedNotification

/** Provider type */
export type Provider = "openai" | "anthropic" | "openrouter" | "minimax" | "google" | "kimi" | "glm"

export interface LopConfig {
    provider?: Provider
    model?: string
    apiKey?: string
    baseURL?: string
    debug?: boolean  // 是否打印调试日志
    // 兼容配置文件的命名
    token?: string
    url?: string
    // MCP 配置
    mcpServers?: Record<string, McpServerConfig>
    mcp?: { allowed?: string[]; excluded?: string[] }
    // 新增：会话持久化开关
    persistence?: {
        enabled?: boolean
        maxAgeDays?: number
        maxSessions?: number
    }
    // 技能系统配置
    skills?: {
        paths?: string[]
    }
    // 权限审批模式
    approvalMode?: "default" | "cautious" | "yolo"
    // 上下文摘要配置（实验功能）
    summary?: SummaryConfig
}

// Summary 配置（实验功能，仅从配置文件读取）
export interface SummaryConfig {
    enabled?: boolean
    provider?: Provider
    model?: string
    apiKey?: string
    baseURL?: string
}

// MCP Server 配置
export interface McpServerConfig {
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    httpUrl?: string
    url?: string
    headers?: Record<string, string>
    timeout?: number
    includeTools?: string[]
    excludeTools?: string[]
}

// MCP RPC 类型
export interface McpServerStatus {
    name: string
    status: "pending" | "connecting" | "connected" | "error"
    error?: string
    tools?: number
}
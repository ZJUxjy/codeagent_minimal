
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

/** 所有通知类型的联合 */
export type ServerNotification =
    | ContentNotification
    | ReasoningNotification
    | ReasoningEndNotification
    | ToolCallNotification
    | ToolResultNotification
    | DoneNotification

export interface LopConfig {
    provider?: "openai" | "anthropic" | "openrouter" | "minimax"
    model?: string
    apiKey?: string
    baseURL?: string
    debug?: boolean  // 是否打印调试日志
    // 兼容配置文件的命名
    token?: string
    url?: string
}
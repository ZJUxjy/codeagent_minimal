// src/server/hooks/types.ts
import type { Tool } from "../tools/types.js"

/** 工具调用信息 */
export interface ToolCall {
    id: string
    name: string
    args: Record<string, unknown>
}

/** 策略决策 */
export type PolicyDecision = "allow" | "deny" | "ask"

/** 循环模式类型 */
export interface LoopPattern {
    type: "tool_repeat" | "content_repeat"
    details: string
}

/**
 * Agent 钩子接口
 * 用于扩展 Agent 行为，如策略控制、循环检测等
 */
export interface AgentHooks {
    /**
     * 工具执行前调用
     * 用于实现策略引擎，控制工具是否允许执行
     */
    beforeToolExecute?(call: ToolCall, tool: Tool): Promise<PolicyDecision>

    /**
     * LLM 调用前调用
     * 用于实现循环检测、上下文压缩等
     */
    beforeLLMCall?(messages: unknown[]): Promise<void>

    /**
     * 检测到循环时调用
     * @returns true 继续执行，false 中断
     */
    onLoopDetected?(pattern: LoopPattern): Promise<boolean>
}

/** 空实现，用于默认值 */
export const noopHooks: AgentHooks = {}
import { describe, it, expect } from "vitest"
import { sessionReducer, createInitialState } from "../sessionReducer.js"
import type { SessionState } from "../types.js"

describe("sessionReducer", () => {
  const initialState = createInitialState()

  it("should handle ADD_MESSAGE", () => {
    const message = {
      id: "test-1",
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    }
    const state = sessionReducer(initialState, { type: "ADD_MESSAGE", message })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toEqual(message)
  })

  it("should handle UPDATE_MESSAGE", () => {
    const message = {
      id: "test-1",
      role: "user" as const,
      content: "Hello",
      timestamp: Date.now(),
    }
    let state = sessionReducer(initialState, { type: "ADD_MESSAGE", message })
    state = sessionReducer(state, {
      type: "UPDATE_MESSAGE",
      id: "test-1",
      update: { content: "Updated" },
    })
    expect(state.messages[0].content).toBe("Updated")
  })

  it("should handle APPEND_CONTENT", () => {
    const state = sessionReducer(initialState, { type: "APPEND_CONTENT", delta: "Hello" })
    expect(state.streaming.content).toBe("Hello")

    const state2 = sessionReducer(state, { type: "APPEND_CONTENT", delta: " World" })
    expect(state2.streaming.content).toBe("Hello World")
  })

  it("should handle APPEND_THINKING", () => {
    const state = sessionReducer(initialState, { type: "APPEND_THINKING", delta: "Thinking..." })
    expect(state.streaming.thinkingContent).toBe("Thinking...")
    expect(state.streaming.isThinkingStreaming).toBe(true)
  })

  it("should handle END_THINKING", () => {
    let state = sessionReducer(initialState, { type: "APPEND_THINKING", delta: "Thinking..." })
    state = sessionReducer(state, { type: "END_THINKING" })
    expect(state.streaming.thinkingContent).toBe("")
    expect(state.streaming.isThinkingStreaming).toBe(false)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe("thinking")
    expect((state.messages[0] as any).content).toBe("Thinking...")
  })

  it("should handle TOOL_CALL", () => {
    const state = sessionReducer(initialState, {
      type: "TOOL_CALL",
      id: "call-1",
      name: "read",
      args: { file_path: "/test.txt" },
    })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe("tool")
    expect((state.messages[0] as any).toolCall.id).toBe("call-1")
    expect((state.messages[0] as any).toolCall.name).toBe("read")
    expect((state.messages[0] as any).toolCall.status).toBe("running")
  })

  it("should handle TOOL_RESULT", () => {
    let state = sessionReducer(initialState, {
      type: "TOOL_CALL",
      id: "call-1",
      name: "read",
      args: { file_path: "/test.txt" },
    })
    state = sessionReducer(state, {
      type: "TOOL_RESULT",
      id: "call-1",
      content: "file content",
    })
    expect((state.messages[0] as any).toolCall.status).toBe("success")
    expect((state.messages[0] as any).toolCall.result).toBe("file content")
  })

  it("should handle TOOL_RESULT with error", () => {
    let state = sessionReducer(initialState, {
      type: "TOOL_CALL",
      id: "call-1",
      name: "read",
      args: { file_path: "/test.txt" },
    })
    state = sessionReducer(state, {
      type: "TOOL_RESULT",
      id: "call-1",
      content: "Error: file not found",
      isError: true,
    })
    expect((state.messages[0] as any).toolCall.status).toBe("error")
    expect((state.messages[0] as any).toolCall.result).toBe("Error: file not found")
  })

  it("should handle STREAM_DONE", () => {
    let state = sessionReducer(initialState, { type: "APPEND_CONTENT", delta: "Response text" })
    state = sessionReducer(state, { type: "SET_LOADING", loading: true })
    state = sessionReducer(state, { type: "STREAM_DONE", content: "Response text" })

    expect(state.streaming.content).toBe("")
    expect(state.isLoading).toBe(false)
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0].role).toBe("assistant")
    expect((state.messages[0] as any).content).toBe("Response text")
  })

  it("should handle STREAM_DONE without content", () => {
    let state = sessionReducer(initialState, { type: "STREAM_DONE", content: "" })
    expect(state.messages).toHaveLength(0)
  })

  it("should handle CLEAR_MESSAGES", () => {
    let state = sessionReducer(initialState, {
      type: "ADD_MESSAGE",
      message: { id: "1", role: "user", content: "Hi", timestamp: Date.now() },
    })
    state = sessionReducer(state, { type: "CLEAR_MESSAGES" })
    expect(state.messages).toHaveLength(0)
  })

  it("should handle SET_LOADING", () => {
    const state = sessionReducer(initialState, { type: "SET_LOADING", loading: true })
    expect(state.isLoading).toBe(true)

    const state2 = sessionReducer(state, { type: "SET_LOADING", loading: false })
    expect(state2.isLoading).toBe(false)
  })

  it("should handle SET_STREAMING", () => {
    const state = sessionReducer(initialState, {
      type: "SET_STREAMING",
      streaming: { isThinkingStreaming: true },
    })
    expect(state.streaming.isThinkingStreaming).toBe(true)
  })

  it("should return state for unknown action", () => {
    const state = sessionReducer(initialState, { type: "UNKNOWN_ACTION" as any })
    expect(state).toEqual(initialState)
  })
})

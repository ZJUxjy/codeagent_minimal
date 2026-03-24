import type { Message, StreamingState } from '../types.js'

/** Session state for the reducer */
export interface SessionState {
  messages: Message[]
  streaming: StreamingState
  isLoading: boolean
}

/** Initial session state */
export const initialSessionState: SessionState = {
  messages: [],
  streaming: {
    content: '',
    thinkingContent: '',
    isThinkingStreaming: false,
  },
  isLoading: false,
}

/** Actions for session reducer */
export type SessionAction =
  | { type: 'ADD_MESSAGE'; message: Message }
  | { type: 'UPDATE_MESSAGE'; id: string; update: Partial<Message> }
  | { type: 'APPEND_CONTENT'; delta: string }
  | { type: 'APPEND_THINKING'; delta: string }
  | { type: 'END_THINKING' }
  | { type: 'TOOL_CALL'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'TOOL_RESULT'; id: string; content: string; isError?: boolean }
  | { type: 'STREAM_DONE'; content: string }
  | { type: 'CLEAR_MESSAGES' }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_STREAMING'; streaming: Partial<StreamingState> }

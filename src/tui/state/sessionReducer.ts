import type { Message } from '../types.js'
import type { SessionState, SessionAction } from './types.js'

/** Session reducer */
export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case 'ADD_MESSAGE':
      return {
        ...state,
        messages: [...state.messages, action.message],
      }

    case 'UPDATE_MESSAGE':
      return {
        ...state,
        messages: state.messages.map(msg =>
          msg.id === action.id ? { ...msg, ...action.update } as Message : msg
        ),
      }

    case 'APPEND_CONTENT':
      return {
        ...state,
        streaming: {
          ...state.streaming,
          content: state.streaming.content + action.delta,
        },
      }

    case 'APPEND_THINKING':
      return {
        ...state,
        streaming: {
          ...state.streaming,
          thinkingContent: state.streaming.thinkingContent + action.delta,
          isThinkingStreaming: true,
        },
      }

    case 'END_THINKING': {
      const thinkingMessage = state.streaming.thinkingContent
        ? {
            id: `thinking-${Date.now()}`,
            role: 'thinking' as const,
            content: state.streaming.thinkingContent,
            isStreaming: false,
            timestamp: Date.now(),
          }
        : null

      return {
        ...state,
        streaming: {
          ...state.streaming,
          thinkingContent: '',
          isThinkingStreaming: false,
        },
        messages: thinkingMessage ? [...state.messages, thinkingMessage] : state.messages,
      }
    }

    case 'TOOL_CALL':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `tool-${Date.now()}`,
            role: 'tool' as const,
            timestamp: Date.now(),
            toolCall: {
              id: action.id,
              name: action.name,
              args: action.args,
              status: 'running' as const,
            },
          },
        ],
      }

    case 'TOOL_RESULT':
      return {
        ...state,
        messages: state.messages.map(msg => {
          if (msg.role === 'tool' && (msg as any).toolCall?.id === action.id) {
            return {
              ...msg,
              toolCall: {
                ...(msg as any).toolCall,
                status: action.isError ? 'error' : 'success',
                result: action.content,
              },
            }
          }
          return msg
        }),
      }

    case 'STREAM_DONE': {
      const assistantMessage = action.content
        ? {
            id: `assistant-${Date.now()}`,
            role: 'assistant' as const,
            content: action.content,
            timestamp: Date.now(),
          }
        : null

      return {
        ...state,
        streaming: {
          content: '',
          thinkingContent: '',
          isThinkingStreaming: false,
        },
        isLoading: false,
        messages: assistantMessage ? [...state.messages, assistantMessage] : state.messages,
      }
    }

    case 'CLEAR_MESSAGES':
      return {
        ...state,
        messages: [],
      }

    case 'SET_LOADING':
      return {
        ...state,
        isLoading: action.loading,
      }

    case 'SET_STREAMING':
      return {
        ...state,
        streaming: {
          ...state.streaming,
          ...action.streaming,
        },
      }

    default:
      return state
  }
}

/** Create initial state helper */
export function createInitialState(): SessionState {
  return {
    messages: [],
    streaming: {
      content: '',
      thinkingContent: '',
      isThinkingStreaming: false,
    },
    isLoading: false,
  }
}

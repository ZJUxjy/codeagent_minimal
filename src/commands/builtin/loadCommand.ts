import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const loadCommand: SlashCommand = {
  name: 'load',
  altNames: ['resume'],
  description: 'Load a previous session by ID. Usage: /load <sessionId>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const sessionId = args.trim()

    if (!sessionId) {
      return { type: 'message', content: 'Usage: /load <sessionId>\nUse /sessions to list available sessions.', isError: true }
    }

    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }

    try {
      const result = await context.client.loadSession(sessionId)
      context.ui.clearMessages()
      return {
        type: 'message',
        content: `Session loaded: ${result.sessionId} (${result.messageCount} messages restored)`,
      }
    } catch (error: any) {
      return { type: 'message', content: `Failed to load session: ${error.message}`, isError: true }
    }
  },
}

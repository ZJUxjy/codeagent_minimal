import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'
import { FileStore } from '../../server/stores/FileStore.js'

export const loadCommand: SlashCommand = {
  name: 'load',
  altNames: ['resume'],
  description: 'Load a previous session by ID (or latest if no ID given). Usage: /load [sessionId]',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    let sessionId = args.trim()

    if (!sessionId) {
      const sessions = FileStore.listSessions(context.config.cwd)
      if (sessions.length === 0) {
        return { type: 'message', content: 'No saved sessions to resume.', isError: true }
      }
      sessionId = sessions[0].sessionId
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

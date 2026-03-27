import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'
import { getErrorMessage } from '../../utils/error.js'

export const deleteCommand: SlashCommand = {
  name: 'delete',
  altNames: ['rm'],
  description: 'Delete a saved session. Usage: /delete <sessionId>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const sessionId = args.trim()
    if (!sessionId) {
      return { type: 'message', content: 'Usage: /delete <sessionId>\nUse /sessions to list available sessions.', isError: true }
    }
    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }
    try {
      await context.client.deleteSession(sessionId)
      return { type: 'message', content: `Session deleted: ${sessionId}` }
    } catch (error: unknown) {
      return { type: 'message', content: `Failed to delete session: ${getErrorMessage(error)}`, isError: true }
    }
  },
}

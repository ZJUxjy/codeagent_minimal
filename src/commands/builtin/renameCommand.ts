import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const renameCommand: SlashCommand = {
  name: 'rename',
  altNames: ['title'],
  description: 'Set a title for a session. Usage: /rename <sessionId> <title>',
  kind: CommandKind.BUILT_IN,

  action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
    const trimmed = args.trim()
    const spaceIdx = trimmed.indexOf(' ')

    if (!trimmed || spaceIdx === -1) {
      return {
        type: 'message',
        content: 'Usage: /rename <sessionId> <title>\nUse /sessions to list available sessions.',
        isError: true,
      }
    }

    const sessionId = trimmed.slice(0, spaceIdx)
    const title = trimmed.slice(spaceIdx + 1).trim()

    if (!title) {
      return { type: 'message', content: 'Title cannot be empty.', isError: true }
    }

    if (!context.client) {
      return { type: 'message', content: 'Error: Client not connected', isError: true }
    }

    try {
      await context.client.renameSession(sessionId, title)
      return { type: 'message', content: `Session renamed: ${sessionId} → "${title}"` }
    } catch (error: any) {
      return { type: 'message', content: `Failed to rename session: ${error.message}`, isError: true }
    }
  },
}

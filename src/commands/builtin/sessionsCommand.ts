import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'
import { FileStore } from '../../server/stores/FileStore.js'

export const sessionsCommand: SlashCommand = {
  name: 'sessions',
  altNames: ['list'],
  description: 'List all saved sessions for current project',
  kind: CommandKind.BUILT_IN,

  action: (context: CommandContext, _args: string): SlashCommandActionReturn => {
    const cwd = context.config.cwd
    const sessions = FileStore.listSessions(cwd)

    if (sessions.length === 0) {
      return { type: 'message', content: 'No saved sessions found. Enable persistence with LOP_PERSISTENCE=true.' }
    }

    const lines = [
      `Found ${sessions.length} session(s):`,
      '',
      ...sessions.map((s, i) => {
        const date = s.mtime.toLocaleString()
        const preview = s.preview ? ` — "${s.preview}"` : ''
        return `${i + 1}. ${s.sessionId} (${s.messageCount} msgs, ${date})${preview}`
      }),
      '',
      'Use /load <sessionId> to resume a session.',
    ]

    return { type: 'message', content: lines.join('\n') }
  },
}

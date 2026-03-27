import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'
import { FileStore } from '../../server/stores/FileStore.js'
import { formatRelativeTime } from '../../server/utils/relativeTime.js'

export const sessionsCommand: SlashCommand = {
  name: 'sessions',
  altNames: ['list'],
  description: 'List all saved sessions for current project',
  kind: CommandKind.BUILT_IN,

  action: (context: CommandContext, _args: string): SlashCommandActionReturn => {
    const cwd = context.config.cwd
    const sessions = FileStore.listSessions(cwd)

    if (sessions.length === 0) {
      return { type: 'message', content: 'No saved sessions found.' }
    }

    const lines = [
      `Found ${sessions.length} session(s):`,
      '',
      ...sessions.map((s, i) => {
        const timeStr = formatRelativeTime(s.mtime)
        const modelStr = s.model ? ` | ${s.provider}/${s.model}` : ''
        const preview = s.preview ? ` — "${s.preview}"` : ''
        return `${i + 1}. ${s.sessionId.slice(0, 8)} (${timeStr}, ${s.messageCount} msgs)${modelStr}${preview}`
      }),
      '',
      'Use /load [sessionId] to resume a session.',
    ]

    return { type: 'message', content: lines.join('\n') }
  },
}

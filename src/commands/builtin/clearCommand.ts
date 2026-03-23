import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const clearCommand: SlashCommand = {
    name: 'clear',
    altNames: ['reset', 'new', 'c'],
    description: 'Clear conversation history and start fresh',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        // 清空客户端历史
        if (context.client) {
            await context.client.clear()
        }

        // 清空 UI 消息
        context.ui.clearMessages()

        return {
            type: 'message',
            content: 'Conversation cleared. Starting fresh!',
        }
    },
}

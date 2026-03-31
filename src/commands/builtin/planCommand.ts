import { CommandKind, type SlashCommand, type SlashCommandActionReturn } from '../types.js'

export const planCommand: SlashCommand = {
    name: 'plan',
    description: 'Enter plan mode — agent analyzes and plans without making changes',
    kind: CommandKind.BUILT_IN,

    action: (context): SlashCommandActionReturn => {
        if (context.client) {
            context.client.setApprovalMode("plan").catch((err) => {
                console.error("Failed to set approval mode:", err)
            })
        }
        return {
            type: 'message',
            content: 'Plan mode activated. The agent will analyze and plan but cannot edit files.\nStart a new session to leave plan mode.',
        }
    },
}

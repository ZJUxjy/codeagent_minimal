import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

const VALID_MODES = ["default", "cautious", "auto", "plan"] as const

export const approvalModeCommand: SlashCommand = {
    name: 'approval-mode',
    altNames: ['am'],
    description: 'Set or show approval mode (default | cautious | auto | plan)',
    kind: CommandKind.BUILT_IN,

    action: (context, args): SlashCommandActionReturn => {
        const mode = args.trim().toLowerCase()

        if (!mode) {
            const current = context.config.approvalMode ?? "default"
            return {
                type: 'message',
                content: `Current approval mode: ${current}\nModes: default (ask for dangerous), cautious (ask for all writes), auto (allow all), plan (no writes)`,
            }
        }

        if (!(VALID_MODES as readonly string[]).includes(mode)) {
            return {
                type: 'message',
                content: `Invalid mode '${mode}'. Valid: ${VALID_MODES.join(', ')}`,
                isError: true,
            }
        }

        if (context.client) {
            context.client.setApprovalMode(mode as typeof VALID_MODES[number]).catch(() => {})
        }

        return { type: 'message', content: `Approval mode set to: ${mode}` }
    },
}

import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const compressCommand: SlashCommand = {
    name: 'compress',
    description: 'Compress context now — summarize old messages to free up token space',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext): Promise<SlashCommandActionReturn> => {
        const { client } = context

        if (!client) {
            return {
                type: 'message',
                content: 'Not connected to server.',
                isError: true,
            }
        }

        try {
            const result = await client.compress()

            switch (result.status) {
                case 'compressed': {
                    const before = Math.round((result.tokensBefore ?? 0) / 1000)
                    const after  = Math.round((result.tokensAfter  ?? 0) / 1000)
                    return {
                        type: 'message',
                        content: `Context compressed: ~${before}K → ~${after}K estimated tokens.`,
                    }
                }
                case 'noop':
                    return {
                        type: 'message',
                        content: 'Nothing to compress — context is short enough.',
                    }
                case 'failed_empty':
                    return {
                        type: 'message',
                        content: 'Compression failed: LLM returned an empty summary.',
                        isError: true,
                    }
                case 'failed_inflated':
                    return {
                        type: 'message',
                        content: 'Compression skipped: summary was larger than the original messages.',
                        isError: true,
                    }
                default:
                    return {
                        type: 'message',
                        content: `Compression status: ${result.status}`,
                    }
            }
        } catch (error: any) {
            return {
                type: 'message',
                content: `Compression failed: ${error.message}`,
                isError: true,
            }
        }
    },
}

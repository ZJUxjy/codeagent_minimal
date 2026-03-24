import { CommandKind, type SlashCommand, type CommandContext, type SlashCommandActionReturn } from '../types.js'

export const mcpCommand: SlashCommand = {
    name: 'mcp',
    altNames: [],
    description: 'MCP server management: /mcp list, /mcp reload',
    kind: CommandKind.BUILT_IN,

    action: async (context: CommandContext, args: string): Promise<SlashCommandActionReturn> => {
        const subcommand = args.trim().toLowerCase()

        if (!context.client) {
            return {
                type: 'message',
                content: 'Error: Client not connected',
            }
        }

        switch (subcommand) {
            case 'list':
                try {
                    const result = await context.client.mcpList()
                    if (!result.servers || result.servers.length === 0) {
                        return {
                            type: 'message',
                            content: 'No MCP servers configured.',
                        }
                    }

                    const lines = result.servers.map(s => {
                        const status = s.status
                        const error = s.error ? ` (${s.error})` : ''
                        return `  • ${s.name}: ${status}${error}`
                    })

                    return {
                        type: 'message',
                        content: `MCP Servers:\n${lines.join('\n')}`,
                    }
                } catch (error: any) {
                    return {
                        type: 'message',
                        content: `Error listing MCP servers: ${error.message}`,
                    }
                }

            case 'reload':
                try {
                    const result = await context.client.mcpReload()
                    const serverCount = result.servers?.length ?? 0
                    const connectedCount = result.servers?.filter(s => s.status === 'connected').length ?? 0

                    return {
                        type: 'message',
                        content: `MCP tools reloaded. ${connectedCount}/${serverCount} servers connected.`,
                    }
                } catch (error: any) {
                    return {
                        type: 'message',
                        content: `Error reloading MCP tools: ${error.message}`,
                    }
                }

            default:
                return {
                    type: 'message',
                    content: 'Usage: /mcp list - Show MCP server status\n       /mcp reload - Rediscover MCP tools',
                }
        }
    },
}

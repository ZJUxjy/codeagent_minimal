import {
    CommandKind,
    type SlashCommand,
    type CommandContext,
    type SlashCommandActionReturn,
} from "../types.js"
import { tryParseThemeId } from "../../tui/themes/presets.js"

function formatThemeList(context: CommandContext): string {
    const rows = context.theme.listBuiltins()
    const lines = [
        "Available themes:",
        "",
        ...rows.map(
            (t) =>
                `  ${t.id.padEnd(12)} — ${t.displayName}${
                    t.id === context.theme.currentId ? "  (current)" : ""
                }`,
        ),
        "",
        "Usage: /theme <id>   example: /theme light",
    ]
    return lines.join("\n")
}

export const themeCommand: SlashCommand = {
    name: "theme",
    altNames: ["themes", "appearance"],
    description: "List or switch UI color theme",
    kind: CommandKind.BUILT_IN,

    action: (
        context: CommandContext,
        args: string,
    ): SlashCommandActionReturn => {
        const arg = args.trim().split(/\s+/)[0] ?? ""

        if (!arg) {
            return { type: "message", content: formatThemeList(context) }
        }

        const id = tryParseThemeId(arg)
        if (!id) {
            return {
                type: "message",
                content: `Unknown theme: "${arg}". Type /theme to see available ids.`,
                isError: true,
            }
        }

        context.theme.applyTheme(id)

        const info = context.theme.listBuiltins().find((t) => t.id === id)
        const label = info?.displayName ?? id
        return {
            type: "message",
            content: `Theme switched to "${label}" (${id}).`,
        }
    },
}

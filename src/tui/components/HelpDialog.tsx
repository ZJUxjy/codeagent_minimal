import { Box, Text } from 'ink';
import React from 'react';
import { useTheme } from '../themes/ThemeContext.js';

interface CommandInfo {
    name: string;
    altNames?: string[];
    description: string;
    subCommands?: { name: string; description: string }[];
}

interface ShortcutInfo {
    key: string;
    description: string;
}

interface HelpDialogProps {
    /** 是否可见 */
    visible?: boolean;
}

/** 内置命令列表 */
const COMMANDS: CommandInfo[] = [
    {
        name: 'help',
        altNames: ['?', 'h'],
        description: 'Show available commands and help',
    },
    {
        name: 'clear',
        altNames: ['reset', 'new', 'c'],
        description: 'Clear conversation history and start fresh',
    },
    {
        name: 'quit',
        altNames: ['exit', 'q', 'bye'],
        description: 'Exit the application',
    },
    {
        name: 'stats',
        altNames: ['usage', 'info'],
        description: 'Show session statistics',
        subCommands: [
            { name: 'model', description: 'Show current model information' },
            { name: 'tools', description: 'Show tool usage statistics' },
        ],
    },
];

/** 快捷键列表 */
const SHORTCUTS: ShortcutInfo[] = [
    { key: 'Ctrl+C', description: 'Quit application' },
    { key: 'Ctrl+L', description: 'Clear screen' },
    { key: '↑ / ↓', description: 'Navigate input history' },
    { key: 'Tab', description: 'Accept suggestion' },
];

/** 格式化命令名称（含别名） */
function formatCommandName(cmd: CommandInfo): string {
    let result = `/${cmd.name}`;
    if (cmd.altNames && cmd.altNames.length > 0) {
        result += ` (${cmd.altNames.join(', ')})`;
    }
    return result;
}

export const HelpDialog = ({ visible = true }: HelpDialogProps) => {
    const { colors } = useTheme();
    if (!visible) return null;

    const maxCmdLength = Math.max(
        ...COMMANDS.map(cmd => formatCommandName(cmd).length)
    );

    return (
        <Box
            flexDirection="column"
            borderStyle="round"
            borderColor={colors.border.focused}
            paddingX={2}
            paddingY={0}
            marginY={0}
        >
            {/* 标题 */}
            <Box justifyContent="center" marginBottom={0}>
                <Text bold color={colors.border.focused}>
                    ═══════════════════════════════════════
                </Text>
            </Box>
            <Box justifyContent="center" marginBottom={0}>
                <Text bold color={colors.status.warning}>
                    📖 Help & Commands
                </Text>
            </Box>
            <Box justifyContent="center" marginBottom={2}>
                <Text bold color={colors.border.focused}>
                    ═══════════════════════════════════════
                </Text>
            </Box>

            {/* 命令列表 */}
            <Box marginBottom={0}>
                <Text bold color={colors.status.success}>
                    Available Commands:
                </Text>
            </Box>

            {COMMANDS.map((cmd, index) => (
                <Box key={cmd.name} flexDirection="column" marginBottom={0}>
                    <Box>
                        <Text color={colors.border.focused} bold>
                            {formatCommandName(cmd)}
                        </Text>
                        <Text> - </Text>
                        <Text dimColor>{cmd.description}</Text>
                    </Box>
                    {/* 子命令 */}
                    {cmd.subCommands?.map(sub => (
                        <Box key={sub.name} marginLeft={maxCmdLength + 4}>
                            <Text color={colors.text.accent}>/{cmd.name} </Text>
                            <Text color={colors.text.accent} bold>{sub.name}</Text>
                            <Text> - </Text>
                            <Text dimColor>{sub.description}</Text>
                        </Box>
                    ))}
                </Box>
            ))}

            {/* 分隔线 */}
            <Box marginY={0}>
                <Text color={colors.text.secondary}>
                    ───────────────────────────────────────
                </Text>
            </Box>

            {/* 快捷键 */}
            <Box marginBottom={0}>
                <Text bold color={colors.status.success}>
                    Keyboard Shortcuts:
                </Text>
            </Box>

            {SHORTCUTS.map(shortcut => (
                <Box key={shortcut.key} marginBottom={0}>
                    <Box width={12}>
                        <Text color={colors.status.warning} bold>
                            {shortcut.key}
                        </Text>
                    </Box>
                    <Box>
                        <Text dimColor>- {shortcut.description}</Text>
                    </Box>
                </Box>
            ))}

            {/* 分隔线 */}
            <Box marginY={0}>
                <Text color={colors.text.secondary}>
                    ───────────────────────────────────────
                </Text>
            </Box>

            {/* 提示信息 */}
            <Box marginTop={0}>
                <Text dimColor italic>
                    💡 Type a message to chat with the AI, or use /help anytime to show this dialog.
                </Text>
            </Box>

            {/* 底部边框 */}
            <Box justifyContent="center" marginTop={0}>
                <Text bold color={colors.border.focused}>
                    ═══════════════════════════════════════
                </Text>
            </Box>
        </Box>
    );
};

export default HelpDialog;

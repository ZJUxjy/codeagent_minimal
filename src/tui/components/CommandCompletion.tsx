import React from 'react'
import { Box, Text } from 'ink'
import type { SlashCommand } from '../../commands/types.js'

interface CommandCompletionProps {
    /** 匹配的命令列表 */
    commands: SlashCommand[]
    /** 当前选中的索引 */
    selectedIndex: number
    /** 用户已输入的部分（用于高亮匹配前缀） */
    inputPrefix: string
}

/**
 * 命令补全列表组件
 *
 * 显示在输入框下方，展示匹配的命令列表，
 * 支持上下键选择，Tab 键补全
 */
export const CommandCompletion: React.FC<CommandCompletionProps> = ({
    commands,
    selectedIndex,
    inputPrefix,
}) => {
    if (commands.length === 0) return null

    // 提取用户输入的命令部分（去掉开头的 /）
    const partial = inputPrefix.startsWith('/') ? inputPrefix.slice(1).toLowerCase() : ''

    return (
        <Box flexDirection="column" marginTop={1} paddingX={2}>
            {commands.map((cmd, index) => {
                const isSelected = index === selectedIndex

                // 命令名：高亮匹配部分
                const commandName = cmd.name
                const matchedPart = commandName.slice(0, partial.length)
                const remainingPart = commandName.slice(partial.length)

                return (
                    <Box key={cmd.name} marginLeft={1}>
                        <Text
                            bold={isSelected}
                            color={isSelected ? 'cyan' : undefined}
                            inverse={isSelected}
                        >
                            {isSelected ? '❯ ' : '  '}
                            /
                            <Text bold color={isSelected ? 'white' : 'cyan'}>
                                {matchedPart}
                            </Text>
                            {remainingPart}
                        </Text>
                        {/* 命令描述 */}
                        {cmd.description && (
                            <Text dimColor>  {cmd.description.slice(0, 50)}</Text>
                        )}
                    </Box>
                )
            })}
            {/* 提示信息 */}
            <Box marginTop={1}>
                <Text dimColor>
                    ↑↓ navigate  Tab accept  Esc cancel
                </Text>
            </Box>
        </Box>
    )
}

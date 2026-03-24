import React from "react"
import { Box, Text } from "ink"
import type { SemanticColors } from "../../themes/types.js"
import type { RenderableBlock } from "./splitProseBlocks.js"
import { RenderInline } from "./InlineRenderer.js"

export interface AssistantProseProps {
    blocks: RenderableBlock[]
    colors: SemanticColors
}

function headingColor(level: number, colors: SemanticColors): string {
    if (level <= 1) return colors.border.focused
    if (level === 2) return colors.text.accent
    return colors.text.secondary
}

/** Markdown 表格中的 `|---|---|` 分隔行 */
function isTableSeparatorRow(line: string): boolean {
    return /^\s*\|[\s\-:|]+\|\s*$/.test(line)
}

/**
 * 助手消息围栏外的 Markdown：块级结构 + 行内 RenderInline
 */
export const AssistantProse: React.FC<AssistantProseProps> = ({
    blocks,
    colors,
}) => {
    return (
        <Box flexDirection="column">
            {blocks.map((block, i) => {
                const key = `b-${i}`
                switch (block.type) {
                    case "heading":
                        return (
                            <Box key={key} marginBottom={0} flexDirection="column">
                                <Text
                                    bold
                                    color={headingColor(block.level, colors)}
                                >
                                    {block.text}
                                </Text>
                            </Box>
                        )
                    case "hr":
                        return (
                            <Box key={key} marginY={0}>
                                <Text dimColor color={colors.text.secondary}>
                                    ────────────────────────────────────────
                                </Text>
                            </Box>
                        )
                    case "ul":
                        return (
                            <Box
                                key={key}
                                flexDirection="column"
                                marginBottom={0}
                            >
                                {block.items.map((item, j) => (
                                    <Box
                                        key={j}
                                        flexDirection="row"
                                        flexWrap="wrap"
                                    >
                                        <Text color={colors.status.success}>
                                            {"• "}
                                        </Text>
                                        <RenderInline
                                            text={item}
                                            colors={colors}
                                        />
                                    </Box>
                                ))}
                            </Box>
                        )
                    case "ol":
                        return (
                            <Box
                                key={key}
                                flexDirection="column"
                                marginBottom={0}
                            >
                                {block.items.map((item, j) => (
                                    <Box
                                        key={j}
                                        flexDirection="row"
                                        flexWrap="wrap"
                                    >
                                        <Text color={colors.border.focused}>
                                            {`${j + 1}. `}
                                        </Text>
                                        <RenderInline
                                            text={item}
                                            colors={colors}
                                        />
                                    </Box>
                                ))}
                            </Box>
                        )
                    case "table": {
                        const rows = block.rows.filter(
                            (r) => !isTableSeparatorRow(r),
                        )
                        return (
                            <Box
                                key={key}
                                flexDirection="column"
                                marginBottom={0}
                                borderStyle="single"
                                borderColor={colors.border.default}
                                paddingX={1}
                            >
                                {rows.map((row, j) => (
                                    <Text
                                        key={j}
                                        color={colors.text.secondary}
                                    >
                                        {row}
                                    </Text>
                                ))}
                            </Box>
                        )
                    }
                    case "blockquote":
                        return (
                            <Box
                                key={key}
                                flexDirection="column"
                                marginBottom={0}
                                borderLeft
                                borderStyle="single"
                                borderColor={colors.border.default}
                                paddingLeft={1}
                            >
                                {block.lines.map((line, j) => (
                                    <Box
                                        key={j}
                                        flexDirection="row"
                                        flexWrap="wrap"
                                    >
                                        <RenderInline
                                            text={line}
                                            colors={colors}
                                            textColor={colors.text.secondary}
                                        />
                                    </Box>
                                ))}
                            </Box>
                        )
                    case "paragraph":
                        return (
                            <Box
                                key={key}
                                flexDirection="column"
                                marginBottom={0}
                            >
                                {block.text.split("\n").map((line, li) => (
                                    <Box
                                        key={li}
                                        flexDirection="row"
                                        flexWrap="wrap"
                                    >
                                        <RenderInline
                                            text={line}
                                            colors={colors}
                                        />
                                    </Box>
                                ))}
                            </Box>
                        )
                }
            })}
        </Box>
    )
}

import React from "react"
import { Box, Text } from "ink"
import type { SemanticColors } from "../../themes/types.js"
import {
    CODE_BLOCK_MAX_CHARS,
    CODE_BLOCK_MAX_LINES,
    truncateCodeForDisplay,
} from "./codeBlockLimits.js"
import { highlightToHast } from "./lowlightInstance.js"
import { hastRootToInkNodes } from "./hastToInk.js"

export interface CodeBlockProps {
    code: string
    /** 围栏第一行语言标记，可能为空 */
    lang?: string
    colors: SemanticColors
}

/**
 * 终端内 fenced code：lowlight → HAST → 多段 Ink Text
 */
export const CodeBlock: React.FC<CodeBlockProps> = ({ code, lang, colors }) => {
    const {
        display: codeToHighlight,
        totalLines,
        omittedLines,
        charCapHit,
    } = truncateCodeForDisplay(code)

    const tree = highlightToHast(lang, codeToHighlight)
    const detected = tree?.data?.language as string | undefined

    const label = lang?.trim()
        ? lang.trim()
        : detected
          ? `${detected} (auto)`
          : "code"

    const inkParts =
        tree && tree.children.length > 0
            ? hastRootToInkNodes(tree, colors)
            : []
    const body =
        inkParts.length > 0 ? (
            inkParts
        ) : (
            <Text color={colors.text.code}>{codeToHighlight}</Text>
        )

    const showFoldHint = omittedLines > 0 || charCapHit
    const foldParts: string[] = []
    if (omittedLines > 0) {
        foldParts.push(
            `··· 已折叠 ${omittedLines} 行（全文 ${totalLines} 行，展示前 ${CODE_BLOCK_MAX_LINES} 行）`,
        )
    }
    if (charCapHit) {
        foldParts.push(`··· 长度已限制在 ${CODE_BLOCK_MAX_CHARS} 字符内`)
    }

    return (
        <Box flexDirection="column" marginY={0} marginTop={0}>
            <Text dimColor color={colors.text.secondary}>
                {label}
            </Text>
            <Box
                flexDirection="row"
                flexWrap="wrap"
                borderStyle="round"
                borderColor={colors.border.default}
                paddingX={1}
                marginTop={0}
            >
                {body}
            </Box>
            {showFoldHint ? (
                <Box marginTop={0} paddingX={0}>
                    <Text dimColor color={colors.text.secondary}>
                        {foldParts.join("  ")}
                    </Text>
                </Box>
            ) : null}
        </Box>
    )
}

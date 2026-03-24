import React from "react"
import { Text } from "ink"
import type { Element, Root, RootContent } from "hast"
import type { SemanticColors } from "../../themes/types.js"
import {
    getElementClasses,
    hljsClassToInkColor,
} from "./hljsColors.js"

/** 从 lowlight Root 取出可遍历的 code 子树（pre>code 或直接子节点） */
function getHighlightChildren(root: Root): RootContent[] {
    if (root.children.length !== 1) {
        return root.children
    }
    const first = root.children[0]
    if (first.type !== "element") {
        return root.children
    }
    const el = first as Element
    if (el.tagName === "pre" && el.children[0]?.type === "element") {
        const inner = el.children[0] as Element
        if (inner.tagName === "code") {
            return inner.children as RootContent[]
        }
    }
    if (el.tagName === "code") {
        return el.children as RootContent[]
    }
    return root.children
}

function walkNodes(
    nodes: RootContent[],
    colors: SemanticColors,
    inherited: string,
    out: React.ReactNode[],
    keyPrefix: string,
): void {
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const k = `${keyPrefix}-${i}`
        if (node.type === "text") {
            out.push(
                <Text key={k} color={inherited}>
                    {node.value}
                </Text>,
            )
            continue
        }
        if (node.type === "element") {
            const el = node as Element
            if (el.tagName === "br") {
                out.push(<Text key={k}>{"\n"}</Text>)
                continue
            }
            const classes = getElementClasses(el)
            const hl = classes.find((c) => c.startsWith("hljs-"))
            const next = hl ? hljsClassToInkColor(hl, colors) : inherited
            walkNodes(
                el.children as RootContent[],
                colors,
                next,
                out,
                k,
            )
        }
    }
}

export function hastRootToInkNodes(
    root: Root,
    colors: SemanticColors,
): React.ReactNode[] {
    const inherited = colors.text.primary
    const children = getHighlightChildren(root)
    const out: React.ReactNode[] = []
    walkNodes(children, colors, inherited, out, "hl")
    return out
}

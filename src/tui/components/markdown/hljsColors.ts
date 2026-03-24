import type { Element } from "hast"
import type { SemanticColors } from "../../themes/types.js"

/** 从 hast element 取 class 列表 */
export function getElementClasses(node: Element): string[] {
    const cn = node.properties.className
    if (Array.isArray(cn)) {
        return cn.map(String)
    }
    if (typeof cn === "string") {
        return cn.split(/\s+/).filter(Boolean)
    }
    return []
}

/**
 * hljs class（如 hljs-keyword）→ Ink 可用颜色
 * 映射对齐常见 highlight.js token 与当前 SemanticColors
 */
export function hljsClassToInkColor(
    hljsClass: string,
    colors: SemanticColors,
): string {
    const base = hljsClass.startsWith("hljs-")
        ? hljsClass.slice("hljs-".length)
        : hljsClass

    switch (base) {
        case "keyword":
        case "selector-tag":
        case "literal":
        case "selector-id":
        case "selector-class":
            return colors.border.focused

        case "string":
        case "meta-string":
        case "bullet":
            return colors.status.success

        case "number":
            return colors.text.accent

        case "comment":
        case "quote":
        case "doctag":
            return colors.ui.comment

        case "function":
        case "title":
        case "section":
            return colors.text.code

        case "built_in":
        case "builtin":
        case "name":
            return colors.ui.symbol

        case "regexp":
        case "template-tag":
            return colors.status.error

        case "attr":
        case "attribute":
            return colors.text.link

        case "variable":
        case "template-variable":
        case "type":
            return colors.text.accent

        case "class":
        case "symbol":
            return colors.status.warning

        case "addition":
            return colors.status.success

        case "deletion":
            return colors.status.error

        case "meta":
        case "subst":
            return colors.text.secondary

        case "link":
            return colors.text.link

        case "emphasis":
        case "strong":
            return colors.text.primary

        default:
            return colors.text.primary
    }
}

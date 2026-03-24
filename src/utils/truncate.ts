export function truncate(text: string, maxLen: number, suffix = "..."): string {
    if (text.length <= maxLen) return text
    return text.slice(0, maxLen) + suffix
}

import { z } from "zod"
import type { Tool, ToolContext } from "./types.js"

const MAX_BYTES = 2 * 1024 * 1024 // 2MB

export const webfetchTool: Tool = {
    name: "webfetch",
    description: `Fetch content from a URL and return it as text, markdown, or raw HTML.
- Requires network access — use only for public URLs
- Response capped at 2MB
- For local files, use the read tool instead`,
    parameters: z.object({
        url: z.string().describe("The URL to fetch (must start with http:// or https://)"),
        format: z.enum(["markdown", "text", "html"]).default("markdown")
            .describe("Return format. markdown strips tags and formats links. text is plain. html is raw."),
        timeout: z.number().optional().describe("Timeout in seconds (max 30, default 10)"),
    }),
    async execute({ url, format, timeout }: { url: string; format: "markdown" | "text" | "html"; timeout?: number }, _ctx: ToolContext) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            return "Error: URL must start with http:// or https://"
        }

        const ssrfError = checkSSRF(url)
        if (ssrfError) return ssrfError

        const timeoutMs = Math.min((timeout ?? 10), 30) * 1000
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)

        try {
            return await fetchAndConvert(url, format, controller.signal)
        } finally {
            clearTimeout(timer)
        }
    },
}

/** Stream a response body with a byte limit — avoids buffering huge responses into memory. */
async function readBodyWithLimit(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string | null> {
    const reader = body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    try {
        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > maxBytes) return null
            chunks.push(value)
        }
    } finally {
        reader.releaseLock()
    }
    const concat = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
        concat.set(chunk, offset)
        offset += chunk.byteLength
    }
    return new TextDecoder().decode(concat)
}

// Best-effort SSRF protection: regex-based hostname check.
// Does not defend against DNS rebinding, IPv6-mapped IPv4, or hex-encoded IPs.
// The real security boundary is the absence of internal credentials — not URL filtering.
function checkSSRF(rawUrl: string): string | undefined {
    let parsed: URL
    try { parsed = new URL(rawUrl) } catch { return "Error: invalid URL" }

    const host = parsed.hostname.toLowerCase()
    if (
        host === "localhost" ||
        host.endsWith(".local") ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^::1$/.test(host) ||
        /^fc00:/i.test(host) ||
        /^fe80:/i.test(host) ||
        host === "0.0.0.0" ||
        host === "metadata.google.internal"
    ) {
        return `Error: requests to private/loopback addresses are not allowed (${host})`
    }
    return undefined
}

async function fetchAndConvert(url: string, format: string, signal: AbortSignal, maxRedirects = 5): Promise<string> {
    let currentUrl = url
    for (let i = 0; i < maxRedirects; i++) {
        const res = await fetch(currentUrl, {
            signal,
            redirect: "manual",
            headers: { "User-Agent": "lop-minimal/1.0" },
        })
        if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("location") ?? ""
            currentUrl = new URL(location, currentUrl).href
            const ssrfError = checkSSRF(currentUrl)
            if (ssrfError) return `Error: redirect blocked — ${ssrfError}`
            continue
        }
        if (!res.ok) return `Error: HTTP ${res.status} ${res.statusText}`
        const contentLength = Number(res.headers.get("content-length") ?? 0)
        if (contentLength > MAX_BYTES) return `Error: response too large (${contentLength} bytes, max 2MB)`
        const rawText = await readBodyWithLimit(res.body!, MAX_BYTES)
        if (rawText === null) return "Error: response body too large (max 2MB)"
        if (format === "html") return rawText
        if (format === "text") return htmlToText(rawText)
        return htmlToMarkdown(rawText)
    }
    return "Error: too many redirects"
}

function stripScriptsAndStyles(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
}

function htmlToText(html: string): string {
    return stripScriptsAndStyles(html)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
}

function htmlToMarkdown(html: string): string {
    return stripScriptsAndStyles(html)
        .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) =>
            "\n" + "#".repeat(Number(level)) + " " + stripTags(text) + "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) =>
            `[${stripTags(text)}](${href})`)
        .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => "`" + code + "`")
        .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => "\n```\n" + stripTags(code) + "\n```\n")
        .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, text) => "- " + stripTags(text) + "\n")
        .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => "\n" + stripTags(text) + "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim()
}

function stripTags(s: string): string {
    return s.replace(/<[^>]+>/g, "").trim()
}

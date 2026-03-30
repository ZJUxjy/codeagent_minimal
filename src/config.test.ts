import { describe, it, expect } from "vitest"
import { mergeConfig } from "./config.js"

describe("mergeConfig", () => {
    it("keeps summary config from file config only", () => {
        const merged = mergeConfig({
            file: { summary: { enabled: true, provider: "glm", model: "glm-4-flash" } },
            cli: { provider: "openai" },
        })
        expect(merged.summary?.enabled).toBe(true)
        expect(merged.summary?.provider).toBe("glm")
        expect(merged.summary?.model).toBe("glm-4-flash")
        // CLI provider should not affect summary provider
        expect(merged.provider).toBe("openai")
    })

    it("does not merge summary from cli or env", () => {
        const merged = mergeConfig({
            cli: { summary: { enabled: true, provider: "anthropic" } } as any,
            env: { summary: { enabled: true, provider: "openai" } } as any,
            file: { summary: { enabled: false, provider: "glm" } },
        })
        // Only file summary should be used
        expect(merged.summary?.enabled).toBe(false)
        expect(merged.summary?.provider).toBe("glm")
    })

    it("returns undefined summary when no file config", () => {
        const merged = mergeConfig({
            cli: { provider: "openai" },
        })
        expect(merged.summary).toBeUndefined()
    })
})

import { describe, it, expect } from "vitest"
import { createThinkTagParser } from "./thinkTagParser.js"

describe("ThinkTagParser", () => {
    it("should parse simple think tags", () => {
        const parser = createThinkTagParser()
        const events = [...parser.feed("Hello" + String.fromCharCode(60) + "think" + String.fromCharCode(62) + "thinking..." + String.fromCharCode(60) + "/think" + String.fromCharCode(62) + " World"), ...parser.flush()]

        expect(events).toEqual([
            { type: "content", delta: "Hello" },
            { type: "reasoning", delta: "thinking..." },
            { type: "reasoning_end" },
            { type: "content", delta: " World" },
        ])
    })

    it("should handle streaming chunks - tag split", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)

        let events = parser.feed("Hello" + lt + "th")
        expect(events).toEqual([
            { type: "content", delta: "Hello" },
        ])

        events = parser.feed("ink" + gt + "thinking")
        expect(events).toEqual([])

        events = parser.feed("..." + lt + "/think" + gt + " World")
        events = [...events, ...parser.flush()]
        expect(events).toEqual([
            { type: "reasoning", delta: "thinking..." },
            { type: "reasoning_end" },
            { type: "content", delta: " World" },
        ])
    })

    it("should handle content without think tags", () => {
        const parser = createThinkTagParser()
        const events = [...parser.feed("Just normal text"), ...parser.flush()]

        // 流式解析器会保留可能是标签前缀的字符，flush 后输出剩余内容
        expect(events).toEqual([
            { type: "content", delta: "Just norma" },
            { type: "content", delta: "l text" },
        ])
    })

    it("should handle think at start", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)
        const events = [...parser.feed(lt + "think" + gt + "think" + lt + "/think" + gt + " end"), ...parser.flush()]

        expect(events).toEqual([
            { type: "reasoning", delta: "think" },
            { type: "reasoning_end" },
            { type: "content", delta: " end" },
        ])
    })

    it("should handle think at end", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)
        const events = [...parser.feed("start" + lt + "think" + gt + "think" + lt + "/think" + gt), ...parser.flush()]

        expect(events).toEqual([
            { type: "content", delta: "start" },
            { type: "reasoning", delta: "think" },
            { type: "reasoning_end" },
        ])
    })

    it("should track isInThink state", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)
        expect(parser.isInThink()).toBe(false)

        parser.feed(lt + "think" + gt + "thinking")
        expect(parser.isInThink()).toBe(true)

        parser.feed(lt + "/think" + gt)
        expect(parser.isInThink()).toBe(false)
    })

    it("should handle incomplete tag at buffer end", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)

        let events = parser.feed("content" + lt + "think")
        expect(events).toEqual([
            { type: "content", delta: "content" },
        ])
        expect(parser.isInThink()).toBe(false)

        events = parser.feed(gt + "inner" + lt + "/think" + gt + " more")
        events = [...events, ...parser.flush()]
        expect(events).toEqual([
            { type: "reasoning", delta: "inner" },
            { type: "reasoning_end" },
            { type: "content", delta: " more" },
        ])
    })

    it("should handle multiple think blocks", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)
        const events = [...parser.feed("a" + lt + "think" + gt + "1" + lt + "/think" + gt + "b" + lt + "think" + gt + "2" + lt + "/think" + gt + "c"), ...parser.flush()]

        expect(events).toEqual([
            { type: "content", delta: "a" },
            { type: "reasoning", delta: "1" },
            { type: "reasoning_end" },
            { type: "content", delta: "b" },
            { type: "reasoning", delta: "2" },
            { type: "reasoning_end" },
            { type: "content", delta: "c" },
        ])
    })

    it("should handle multiline thinking content", () => {
        const parser = createThinkTagParser()
        const lt = String.fromCharCode(60)
        const gt = String.fromCharCode(62)
        const events = [...parser.feed(lt + "think" + gt + "line1\nline2\nline3" + lt + "/think" + gt + "done"), ...parser.flush()]

        expect(events).toEqual([
            { type: "reasoning", delta: "line1\nline2\nline3" },
            { type: "reasoning_end" },
            { type: "content", delta: "done" },
        ])
    })
})

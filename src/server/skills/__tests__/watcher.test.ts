import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// We must define mock fns before vi.mock so they're available in hoisted factories.
// vi.hoisted() ensures these are evaluated before mock hoisting.
const { mockLoadSkills, mockOn, mockClose, mockWatch } = vi.hoisted(() => {
    const mockLoadSkills = vi.fn()
    const mockOn = vi.fn()
    const mockClose = vi.fn().mockResolvedValue(undefined)
    const mockWatch = vi.fn().mockReturnValue({
        on: mockOn,
        close: mockClose,
    })
    return { mockLoadSkills, mockOn, mockClose, mockWatch }
})

vi.mock("../loader.js", () => ({
    loadSkills: (...args: unknown[]) => mockLoadSkills(...args),
}))

vi.mock("chokidar", () => ({
    watch: mockWatch,
}))

import { SkillWatcher } from "../watcher.js"

describe("SkillWatcher", () => {
    let watcher: SkillWatcher

    const testSkill = {
        name: "test-skill",
        description: "A test skill",
        filePath: "/project/.lop/skills/test-skill/SKILL.md",
        baseDir: "/project/.lop/skills/test-skill",
        disableModelInvocation: false,
    }

    beforeEach(() => {
        vi.useFakeTimers()
        mockLoadSkills.mockReset()
        mockOn.mockReset()
        mockClose.mockReset().mockResolvedValue(undefined)
        mockWatch.mockReset().mockReturnValue({
            on: mockOn,
            close: mockClose,
        })
        mockLoadSkills.mockResolvedValue({ skills: [testSkill], diagnostics: [] })
    })

    afterEach(async () => {
        await watcher?.stop()
        vi.useRealTimers()
    })

    it("should call loadSkills on start with cwd", async () => {
        watcher = new SkillWatcher("/project")
        const onReload = vi.fn()
        await watcher.start({ onReload })

        expect(mockLoadSkills).toHaveBeenCalledWith("/project")
    })

    it("should still watch common skill directories even when no skills found", async () => {
        mockLoadSkills.mockResolvedValue({ skills: [], diagnostics: [] })

        watcher = new SkillWatcher("/project")
        const onReload = vi.fn()
        await watcher.start({ onReload })

        // Watcher is still created for common discovery paths
        expect(mockWatch).toHaveBeenCalled()
        const watchedDirs = mockWatch.mock.calls[0][0] as string[]
        expect(watchedDirs).toContain("/project/.lop/skills")
        expect(watchedDirs).toContain("/project/.agents/skills")
    })

    it("should register watchers for file events", async () => {
        watcher = new SkillWatcher("/project")
        const onReload = vi.fn()
        await watcher.start({ onReload })

        // Should register handlers for add, change, unlink, unlinkDir, addDir
        const eventNames = mockOn.mock.calls.map((call: unknown[]) => call[0])
        expect(eventNames).toContain("add")
        expect(eventNames).toContain("change")
        expect(eventNames).toContain("unlink")
        expect(eventNames).toContain("unlinkDir")
        expect(eventNames).toContain("addDir")
    })

    it("should call onReload after debounce period on file change", async () => {
        mockLoadSkills.mockResolvedValueOnce({ skills: [testSkill], diagnostics: [] })

        watcher = new SkillWatcher("/project", 150)
        const onReload = vi.fn()
        await watcher.start({ onReload })

        // Initial load happened during start
        expect(mockLoadSkills).toHaveBeenCalledTimes(1)

        // Set up mock for the reload call
        mockLoadSkills.mockResolvedValueOnce({
            skills: [testSkill],
            diagnostics: ["skill reloaded"],
        })

        // Find the 'change' handler from chokidar mock
        const changeHandler = mockOn.mock.calls.find(
            (call: unknown[]) => call[0] === "change",
        )?.[1] as (() => void) | undefined
        expect(changeHandler).toBeDefined()

        // Trigger file change event
        changeHandler!()

        // Not yet called (debounce)
        expect(onReload).not.toHaveBeenCalled()

        // Advance past debounce
        await vi.advanceTimersByTimeAsync(200)

        expect(onReload).toHaveBeenCalledTimes(1)
        expect(onReload).toHaveBeenCalledWith({
            skills: [testSkill],
            diagnostics: ["skill reloaded"],
        })
    })

    it("should debounce multiple rapid file events into single reload", async () => {
        watcher = new SkillWatcher("/project", 150)
        const onReload = vi.fn()
        await watcher.start({ onReload })

        mockLoadSkills.mockResolvedValue({
            skills: [testSkill],
            diagnostics: [],
        })

        const changeHandler = mockOn.mock.calls.find(
            (call: unknown[]) => call[0] === "change",
        )?.[1] as (() => void) | undefined

        // Fire 3 rapid events
        changeHandler!()
        changeHandler!()
        changeHandler!()

        await vi.advanceTimersByTimeAsync(200)

        // Only one reload should happen
        expect(onReload).toHaveBeenCalledTimes(1)
        // loadSkills called once for initial + once for debounced reload
        expect(mockLoadSkills).toHaveBeenCalledTimes(2)
    })

    it("should call onError when loadSkills throws during reload", async () => {
        watcher = new SkillWatcher("/project", 100)
        const onReload = vi.fn()
        const onError = vi.fn()
        await watcher.start({ onReload, onError })

        // Make the next loadSkills call throw
        mockLoadSkills.mockRejectedValueOnce(new Error("Disk error"))

        const changeHandler = mockOn.mock.calls.find(
            (call: unknown[]) => call[0] === "change",
        )?.[1] as (() => void) | undefined

        changeHandler!()
        await vi.advanceTimersByTimeAsync(150)

        expect(onError).toHaveBeenCalledTimes(1)
        expect(onError).toHaveBeenCalledWith(expect.any(Error))
        expect(onError.mock.calls[0][0].message).toBe("Disk error")
        // onReload should NOT have been called (error occurred)
        expect(onReload).not.toHaveBeenCalled()
    })

    it("should handle non-Error thrown values", async () => {
        watcher = new SkillWatcher("/project", 100)
        const onError = vi.fn()
        await watcher.start({ onReload: vi.fn(), onError })

        // Throw a string instead of Error
        mockLoadSkills.mockRejectedValueOnce("something broke")

        const changeHandler = mockOn.mock.calls.find(
            (call: unknown[]) => call[0] === "change",
        )?.[1] as (() => void) | undefined

        changeHandler!()
        await vi.advanceTimersByTimeAsync(150)

        expect(onError).toHaveBeenCalledWith(expect.any(Error))
        expect(onError.mock.calls[0][0].message).toBe("something broke")
    })

    it("should stop cleanly and close watcher", async () => {
        watcher = new SkillWatcher("/project")
        await watcher.start({ onReload: vi.fn() })
        await watcher.stop()

        expect(mockClose).toHaveBeenCalledTimes(1)
    })

    it("should not throw on double stop", async () => {
        watcher = new SkillWatcher("/project")
        await watcher.start({ onReload: vi.fn() })
        await watcher.stop()
        await watcher.stop()

        // close called once (second stop has no watcher)
        expect(mockClose).toHaveBeenCalledTimes(1)
    })

    it("should cancel pending debounce timer on stop", async () => {
        watcher = new SkillWatcher("/project", 200)
        const onReload = vi.fn()
        await watcher.start({ onReload })

        mockLoadSkills.mockResolvedValue({
            skills: [testSkill],
            diagnostics: [],
        })

        const changeHandler = mockOn.mock.calls.find(
            (call: unknown[]) => call[0] === "change",
        )?.[1] as (() => void) | undefined

        changeHandler!()

        // Stop before debounce fires
        await watcher.stop()

        // Advance timer past debounce
        await vi.advanceTimersByTimeAsync(300)

        // onReload should NOT have been called (timer was cancelled)
        expect(onReload).not.toHaveBeenCalled()
    })
})

import { z } from "zod"
import { writeFile, mkdir } from "fs/promises"
import * as path from "path"
import type { Tool, ToolContext } from "./types.js"

const TodoItem = z.object({
    id: z.string().describe("Unique identifier for the todo item"),
    content: z.string().min(1).describe("Brief description of the task"),
    status: z.enum(["pending", "in_progress", "completed"]).describe("Current status"),
    priority: z.enum(["high", "medium", "low"]).optional().describe("Priority level"),
})

export const todowriteTool: Tool = {
    name: "todowrite",
    description: `Manage a structured todo list for tracking tasks in the current session.
- Use for tasks with 3 or more distinct steps
- Keep at most one item in_progress at a time
- Update in real-time as work progresses — do not batch updates
- The list persists for the session and is shown to the user`,
    parameters: z.object({
        todos: z.array(TodoItem).describe("The complete updated todo list (full replace)"),
    }),

    async execute({ todos }: { todos: z.infer<typeof TodoItem>[] }, ctx: ToolContext) {
        const inProgress = todos.filter(t => t.status === "in_progress")
        if (inProgress.length > 1) {
            return "Error: at most one todo item can be in_progress at a time"
        }

        const ids = todos.map(t => t.id)
        if (new Set(ids).size !== ids.length) {
            return "Error: todo item IDs must be unique"
        }

        const todoDir = path.join(ctx.cwd, ".lop")
        await mkdir(todoDir, { recursive: true })
        const todoFile = path.join(todoDir, "todos.json")
        await writeFile(todoFile, JSON.stringify(todos, null, 2), "utf-8")

        const pending = todos.filter(t => t.status === "pending").length
        const done = todos.filter(t => t.status === "completed").length
        const summary = todos.length === 0
            ? "Todo list cleared."
            : `Todo list updated: ${todos.length} items (${pending} pending, ${done} completed)`

        return summary + "\n\n" + JSON.stringify(todos, null, 2)
    },
}

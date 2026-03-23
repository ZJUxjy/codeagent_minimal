import type { Tool } from "./types.js"
import { readTool } from "./read.js"
import { writeTool } from "./write.js"
import { editTool } from "./edit.js"
import { bashTool } from "./bash.js"
import { globTool } from "./glob.js"
import { grepTool } from "./grep.js"
import { listDirectoryTool } from "./listDirectory.js"

export class ToolRegistry {
    private tools = new Map<string, Tool>()

    constructor() {
        this.register(readTool)
        this.register(writeTool)
        this.register(editTool)
        this.register(bashTool)
        this.register(globTool)
        this.register(grepTool)
        this.register(listDirectoryTool)
    }
    register(tool: Tool): void {
        this.tools.set(tool.name, tool)
    }

    get(name: string): Tool | undefined {
        return this.tools.get(name)
    }

    getAll(): Tool[] {
        return Array.from(this.tools.values())
    }

    getToolDefinitions(): Record<string, { description: string; parameters: unknown }> {
        const defs: Record<string, { description: string; parameters: unknown }> = {}
        for (const tool of this.getAll()) {
            defs[tool.name] = {
                description: tool.description,
                parameters: tool.parameters,
            }
        }
        return defs
    }
}

export * from "./types.js"


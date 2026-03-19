#!/usr/bin/env node
// src/index.ts - CLI 入口
import * as readline from "readline"
import { Client, type ClientEvent } from "./client/index.js"

interface CLIOptions {
    provider?: string
    model?: string
    cwd?: string
}

function parseArgs(): CLIOptions {
    const args = process.argv.slice(2)
    const options: CLIOptions = {}

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "-p" || arg === "--provider") {
            options.provider = args[++i]
        } else if (arg === "-m" || arg === "--model") {
            options.model = args[++i]
        } else if (arg === "-d" || arg === "--directory") {
            options.cwd = args[++i]
        }
    }

    return options
}

async function main() {
    const options = parseArgs()
    const cwd = options.cwd ?? process.cwd()

    console.log("lop_minimal v0.1.0")
    console.log(`Provider: ${options.provider ?? "openai"}`)
    console.log(`Model: ${options.model ?? "gpt-4o"}`)
    console.log(`Working directory: ${cwd}`)
    console.log("\nType your message and press Enter. Ctrl+C to exit.\n")

    // 创建 Client
    const client = new Client(options)

    // 设置事件处理器
    client.onEvent((event: ClientEvent) => {
        switch (event.type) {
            case "content":
                process.stdout.write(event.delta)
                break
            case "tool_call":
                console.log(`\n🔧 ${event.name}(${JSON.stringify(event.args)})`)
                break
            case "tool_result":
                const icon = event.isError ? "❌" : "✅"
                const preview = event.content.length > 200
                    ? event.content.slice(0, 200) + "..."
                    : event.content
                console.log(`${icon} ${preview}`)
                break
            case "done":
                console.log("\n")
                break
        }
    })

    // 初始化
    try {
        await client.initialize()
    } catch (error: any) {
        console.error("Failed to initialize:", error.message)
        process.exit(1)
    }

    // REPL 循环
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    })

    const prompt = () => {
        rl.question("> ", async (input) => {
            const trimmed = input.trim()

            if (!trimmed) {
                prompt()
                return
            }

            // 命令处理
            if (trimmed === "/clear") {
                await client.clear()
                console.log("History cleared.\n")
                prompt()
                return
            }

            if (trimmed === "/help") {
                console.log(`
  Commands:
    /clear  - Clear conversation history
    /help   - Show this help
    Ctrl+C  - Exit
          `)
                prompt()
                return
            }

            // 发送消息
            try {
                await client.chat(trimmed, cwd)
            } catch (error: any) {
                console.error(`Error: ${error.message}\n`)
            }

            prompt()
        })
    }

    // 处理退出
    rl.on("close", () => {
        client.close()
        console.log("Goodbye!")
    })

    prompt()
}

main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
})
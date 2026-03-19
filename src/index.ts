#!/usr/bin/env node
// src/index.ts - CLI 入口
import * as readline from "readline"
import { Client, type ClientEvent, type ClientOptions } from "./client/index.js"
import { loadConfig } from "./config.js"

async function main() {
    // 加载配置文件
    const fileConfig = loadConfig()

    // 解析命令行参数
    const args = process.argv.slice(2)
    const cliOptions: Partial<ClientOptions> = {}

    for (let i = 0; i < args.length; i++) {
        const arg = args[i]
        if (arg === "-p" || arg === "--provider") {
            cliOptions.provider = args[++i]
        } else if (arg === "-m" || arg === "--model") {
            cliOptions.model = args[++i]
        } else if (arg === "-d" || arg === "--directory") {
            cliOptions.cwd = args[++i]
        } else if (arg === "--debug") {
            cliOptions.debug = true
        }
    }

    // 合并配置（优先级：命令行 > 配置文件）
    const options: ClientOptions = {
        provider: cliOptions.provider ?? fileConfig.provider,
        model: cliOptions.model ?? fileConfig.model,
        apiKey: fileConfig.apiKey,
        baseURL: fileConfig.baseURL,
        cwd: cliOptions.cwd,
        debug: cliOptions.debug ?? fileConfig.debug,
    }

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

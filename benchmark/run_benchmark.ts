#!/usr/bin/env tsx
/**
 * LiveBench Coding Benchmark Runner
 *
 * Usage:
 *   tsx benchmark/run_benchmark.ts [options]
 *
 * Options:
 *   --model <model>        Model to test (default: from env LOP_MODEL)
 *   --provider <provider>  Provider (default: from env LOP_PROVIDER)
 *   --limit <n>            Max number of problems to run (default: all)
 *   --task <type>          Filter by task: LCB_generation | coding_completion (default: all)
 *   --output <file>        Results JSONL path (default: benchmark/results/<model>_<timestamp>.jsonl)
 *   --concurrency <n>      Parallel agents (default: 1)
 */

import * as fs from "fs"
import * as path from "path"
import * as readline from "readline"
import { Client } from "../src/client/index.js"

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2)
    const opts: Record<string, string> = {}
    for (let i = 0; i < args.length; i += 2) {
        opts[args[i].replace(/^--/, "")] = args[i + 1] ?? ""
    }
    return opts
}

const opts = parseArgs()
const MODEL = opts.model ?? process.env.LOP_MODEL ?? "claude-haiku-4-5-20251001"
const PROVIDER = opts.provider ?? process.env.LOP_PROVIDER ?? "anthropic"
const LIMIT = opts.limit ? parseInt(opts.limit) : Infinity
const TASK_FILTER = opts.task ?? null
const CONCURRENCY = opts.concurrency ? parseInt(opts.concurrency) : 1
const DATA_FILE = path.join(import.meta.dirname, "data", "livebench_coding.jsonl")

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const modelSlug = MODEL.replace(/[^a-zA-Z0-9-]/g, "_")
const DEFAULT_OUTPUT = path.join(
    import.meta.dirname,
    "results",
    `${modelSlug}_${timestamp}.jsonl`,
)
const OUTPUT_FILE = opts.output ?? DEFAULT_OUTPUT

// ── Types ────────────────────────────────────────────────────────────────────

interface Problem {
    question_id: string
    question_title: string
    task: string
    turns: string[]
    public_test_cases: string
    private_test_cases: string
    original_json: {
        starter_code: string
        difficulty: string
        metadata: string
        question_content: string
    }
    partial_solution?: string
    solution?: string
}

interface BenchmarkResult {
    question_id: string
    question_title: string
    task: string
    model: string
    provider: string
    prompt: string
    response: string
    elapsed_ms: number
    error?: string
}

// ── Load problems ─────────────────────────────────────────────────────────────

function loadProblems(): Problem[] {
    const lines = fs.readFileSync(DATA_FILE, "utf-8").trim().split("\n")
    let problems = lines.map(l => JSON.parse(l) as Problem)

    if (TASK_FILTER) {
        problems = problems.filter(p => p.task === TASK_FILTER)
    }
    if (LIMIT < Infinity) {
        problems = problems.slice(0, LIMIT)
    }
    return problems
}

// ── Run single problem ────────────────────────────────────────────────────────

async function runProblem(problem: Problem): Promise<BenchmarkResult> {
    const prompt = problem.turns[0]
    const startTime = Date.now()

    return new Promise((resolve) => {
        const client = new Client({
            model: MODEL,
            provider: PROVIDER,
        })

        let response = ""
        let done = false
        let initError: string | undefined

        client.onEvent(event => {
            if (event.type === "content") {
                response += event.delta
            } else if (event.type === "done") {
                done = true
            }
        })

        client.initialize()
            .then(() => client.chat(prompt))
            .catch(err => {
                initError = err.message
                done = true
            })

        // Poll until done (max 5 min)
        const startPoll = Date.now()
        const interval = setInterval(() => {
            if (done || Date.now() - startPoll > 300_000) {
                clearInterval(interval)
                client.close()
                resolve({
                    question_id: problem.question_id,
                    question_title: problem.question_title,
                    task: problem.task,
                    model: MODEL,
                    provider: PROVIDER,
                    prompt,
                    response,
                    elapsed_ms: Date.now() - startTime,
                    error: initError,
                })
            }
        }, 200)
    })
}

// ── Worker pool ───────────────────────────────────────────────────────────────

async function runWithConcurrency(
    problems: Problem[],
    concurrency: number,
    onResult: (r: BenchmarkResult, idx: number, total: number) => void,
): Promise<BenchmarkResult[]> {
    const results: BenchmarkResult[] = []
    let idx = 0

    async function worker() {
        while (idx < problems.length) {
            const i = idx++
            const result = await runProblem(problems[i])
            onResult(result, i + 1, problems.length)
            results.push(result)
        }
    }

    await Promise.all(Array.from({ length: concurrency }, worker))
    return results
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const problems = loadProblems()
    console.log(`\nLiveBench Coding Benchmark`)
    console.log(`  Model:       ${MODEL}`)
    console.log(`  Provider:    ${PROVIDER}`)
    console.log(`  Problems:    ${problems.length}`)
    console.log(`  Task filter: ${TASK_FILTER ?? "all"}`)
    console.log(`  Concurrency: ${CONCURRENCY}`)
    console.log(`  Output:      ${OUTPUT_FILE}\n`)

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
    const outStream = fs.createWriteStream(OUTPUT_FILE, { flags: "a" })

    let passed = 0
    let failed = 0
    let errors = 0

    await runWithConcurrency(problems, CONCURRENCY, (result, i, total) => {
        outStream.write(JSON.stringify(result) + "\n")

        const status = result.error ? "ERR" : result.response ? "OK " : "???"
        if (result.error) errors++
        else if (result.response) passed++
        else failed++

        const pct = ((i / total) * 100).toFixed(0).padStart(3)
        console.log(`[${pct}%] ${i}/${total} ${status} ${result.question_title}`)
    })

    outStream.end()

    console.log(`\nDone! Saved to ${OUTPUT_FILE}`)
    console.log(`  Completed: ${passed}`)
    console.log(`  Empty:     ${failed}`)
    console.log(`  Errors:    ${errors}`)
    console.log(`\nNext step: python3 benchmark/evaluate.py --results ${OUTPUT_FILE}`)
}

main().catch(err => {
    console.error("Fatal:", err)
    process.exit(1)
})

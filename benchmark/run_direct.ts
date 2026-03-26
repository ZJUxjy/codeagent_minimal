#!/usr/bin/env tsx
/**
 * LiveBench Direct LLM Runner (baseline)
 *
 * Sends prompts directly to the LLM (no agent, no tools) — matching
 * how LiveBench actually evaluates models.
 *
 * Usage:
 *   tsx benchmark/run_direct.ts [options]
 *
 * Options:
 *   --model <model>        Model to test (default: from env LOP_MODEL)
 *   --provider <provider>  Provider (default: from env LOP_PROVIDER)
 *   --limit <n>            Max problems (default: all)
 *   --task <type>          LCB_generation | coding_completion (default: all)
 *   --output <file>        Results JSONL (default: benchmark/results/<model>_direct_<ts>.jsonl)
 *   --concurrency <n>      Parallel requests (default: 3)
 */

import * as fs from "fs"
import * as path from "path"
import { generateText } from "ai"
import { createAnthropic } from "@ai-sdk/anthropic"
import { normalizeAnthropicCompatibleBaseURL } from "../src/llm.js"
import { openai, createOpenAI } from "@ai-sdk/openai"

// ── CLI args ─────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2)
    const opts: Record<string, string> = {}
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            opts[args[i].replace(/^--/, "")] = args[i + 1] ?? ""
            i++
        }
    }
    return opts
}

const opts = parseArgs()
const MODEL = opts.model ?? process.env.LOP_MODEL ?? "claude-haiku-4-5-20251001"
const PROVIDER = opts.provider ?? process.env.LOP_PROVIDER ?? "anthropic"
const LIMIT = opts.limit ? parseInt(opts.limit) : Infinity
const TASK_FILTER = opts.task ?? null
const CONCURRENCY = opts.concurrency ? parseInt(opts.concurrency) : 3
const DATA_FILE = path.join(import.meta.dirname, "data", "livebench_coding.jsonl")

const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const modelSlug = MODEL.replace(/[^a-zA-Z0-9-]/g, "_")
const DEFAULT_OUTPUT = path.join(
    import.meta.dirname,
    "results",
    `${modelSlug}_direct_${timestamp}.jsonl`,
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
    original_json: Record<string, unknown>
}

// ── Model factory ─────────────────────────────────────────────────────────────

function getModel() {
    const apiKey = process.env.LOP_API_KEY ?? process.env.ANTHROPIC_API_KEY
    const baseURL = process.env.LOP_BASE_URL

    switch (PROVIDER) {
        case "anthropic": {
            const client = createAnthropic({
                apiKey,
                ...(baseURL
                    ? { baseURL: normalizeAnthropicCompatibleBaseURL(baseURL, baseURL) }
                    : {}),
            })
            return client(MODEL)
        }
        case "openai": {
            const client = createOpenAI({ apiKey, baseURL })
            return client(MODEL)
        }
        case "openrouter": {
            const client = createOpenAI({
                baseURL: baseURL ?? "https://openrouter.ai/api/v1",
                apiKey,
            })
            return client(MODEL)
        }
        default:
            throw new Error(`Unsupported provider: ${PROVIDER}`)
    }
}

// ── Load problems ─────────────────────────────────────────────────────────────

function loadProblems(): Problem[] {
    const lines = fs.readFileSync(DATA_FILE, "utf-8").trim().split("\n")
    let problems = lines.map(l => JSON.parse(l) as Problem)
    if (TASK_FILTER) problems = problems.filter(p => p.task === TASK_FILTER)
    if (LIMIT < Infinity) problems = problems.slice(0, LIMIT)
    return problems
}

// ── Run single problem ────────────────────────────────────────────────────────

async function runProblem(problem: Problem, model: ReturnType<typeof getModel>) {
    const prompt = problem.turns[0]
    const startTime = Date.now()

    try {
        const result = await generateText({
            model,
            messages: [{ role: "user", content: prompt }],
            maxTokens: 2048,
        })

        return {
            question_id: problem.question_id,
            question_title: problem.question_title,
            task: problem.task,
            model: MODEL,
            provider: PROVIDER,
            prompt,
            response: result.text,
            elapsed_ms: Date.now() - startTime,
        }
    } catch (err: any) {
        return {
            question_id: problem.question_id,
            question_title: problem.question_title,
            task: problem.task,
            model: MODEL,
            provider: PROVIDER,
            prompt,
            response: "",
            elapsed_ms: Date.now() - startTime,
            error: err.message,
        }
    }
}

// ── Worker pool ───────────────────────────────────────────────────────────────

async function runWithConcurrency(
    problems: Problem[],
    concurrency: number,
    model: ReturnType<typeof getModel>,
    onResult: (r: any, idx: number, total: number) => void,
) {
    const results: any[] = []
    let idx = 0

    async function worker() {
        while (idx < problems.length) {
            const i = idx++
            const result = await runProblem(problems[i], model)
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
    const model = getModel()

    console.log(`\nLiveBench Direct LLM Benchmark`)
    console.log(`  Model:       ${MODEL}`)
    console.log(`  Provider:    ${PROVIDER}`)
    console.log(`  Problems:    ${problems.length}`)
    console.log(`  Task filter: ${TASK_FILTER ?? "all"}`)
    console.log(`  Concurrency: ${CONCURRENCY}`)
    console.log(`  Output:      ${OUTPUT_FILE}\n`)

    fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true })
    const outStream = fs.createWriteStream(OUTPUT_FILE, { flags: "a" })

    let ok = 0
    let errors = 0

    await runWithConcurrency(problems, CONCURRENCY, model, (result, i, total) => {
        outStream.write(JSON.stringify(result) + "\n")
        const status = result.error ? "ERR" : "OK "
        if (result.error) errors++
        else ok++
        const pct = ((i / total) * 100).toFixed(0).padStart(3)
        console.log(`[${pct}%] ${i}/${total} ${status} ${result.question_title}`)
    })

    outStream.end()

    console.log(`\nDone! ${ok} OK, ${errors} errors → ${OUTPUT_FILE}`)
    console.log(`Next: python3 benchmark/evaluate.py --results ${OUTPUT_FILE}`)
}

main().catch(err => {
    console.error("Fatal:", err)
    process.exit(1)
})

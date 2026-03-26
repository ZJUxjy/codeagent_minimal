# LiveBench Coding Benchmark

Evaluates LLM/agent performance on [LiveBench coding tasks](https://huggingface.co/datasets/livebench/coding).

## Dataset

128 problems from LeetCode contests (2024), two task types:
- **LCB_generation** (78): write a complete Python solution
- **coding_completion** (50): complete a partial solution

## Prerequisites

```bash
pip install datasets huggingface_hub   # already done
npm run build                          # build the agent server
```

Set API credentials:
```bash
export LOP_API_KEY=sk-ant-...          # Anthropic
export LOP_PROVIDER=anthropic
export LOP_MODEL=claude-haiku-4-5-20251001
```

## Quick Start

### Step 1: Validate the evaluator (no API key needed)
```bash
python3 benchmark/validate.py
```

### Step 2: Run the benchmark

**Option A – Direct LLM** (baseline, matches LiveBench's evaluation method):
```bash
npx tsx benchmark/run_direct.ts --limit 10   # test 10 problems
npx tsx benchmark/run_direct.ts              # all 128 problems
```

**Option B – Coding Agent** (agent can use bash/tools to verify code):
```bash
npx tsx benchmark/run_benchmark.ts --limit 10
npx tsx benchmark/run_benchmark.ts --concurrency 1
```

### Step 3: Evaluate results
```bash
# Score with public test cases (2-3 per problem)
python3 benchmark/evaluate.py --results benchmark/results/your_file.jsonl

# Score with private test cases (12 per problem, harder)
python3 benchmark/evaluate.py --results benchmark/results/your_file.jsonl --use-private

# Verbose output (see per-problem results)
python3 benchmark/evaluate.py --results benchmark/results/your_file.jsonl -v

# Compare multiple models
python3 benchmark/evaluate.py --results benchmark/results/*.jsonl
```

## Options

### run_direct.ts / run_benchmark.ts
| Flag | Default | Description |
|------|---------|-------------|
| `--model` | `$LOP_MODEL` | Model identifier |
| `--provider` | `$LOP_PROVIDER` | Provider (anthropic/openai/openrouter) |
| `--limit N` | all | Max problems to run |
| `--task TYPE` | all | `LCB_generation` or `coding_completion` |
| `--concurrency N` | 3 (direct) / 1 (agent) | Parallel requests |
| `--output FILE` | auto-generated | Results JSONL path |

### evaluate.py
| Flag | Description |
|------|-------------|
| `--use-private` | Use private test cases (12/problem vs 2-3 public) |
| `--verbose/-v` | Show per-problem pass/fail |
| `--save FILE` | Save summary to JSONL |

## Results Format

Runner output (`benchmark/results/*.jsonl`):
```json
{"question_id": "...", "task": "LCB_generation", "model": "claude-haiku-4-5-20251001",
 "response": "class Solution:\n...", "elapsed_ms": 1234}
```

## Comparing Direct vs Agent

The key research question: does the agent framework improve coding accuracy?

```bash
# Baseline: direct LLM
npx tsx benchmark/run_direct.ts --model claude-haiku-4-5-20251001 --output benchmark/results/haiku_direct.jsonl

# Agent: uses bash tool to test code before submitting
npx tsx benchmark/run_benchmark.ts --model claude-haiku-4-5-20251001 --output benchmark/results/haiku_agent.jsonl

# Compare
python3 benchmark/evaluate.py --results benchmark/results/haiku_direct.jsonl benchmark/results/haiku_agent.jsonl
```

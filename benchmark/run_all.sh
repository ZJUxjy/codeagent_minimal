#!/bin/bash
# 运行三个供应商的 benchmark，使用相同的 20 道题目

set -e
cd "$(dirname "$0")/.."

LIMIT=20
CONCURRENCY=2
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

echo "=== LiveBench Benchmark ==="
echo "Limit: $LIMIT problems"
echo "Concurrency: $CONCURRENCY"
echo ""

# 1. GLM
echo ">>> Running GLM benchmark..."
LOP_PROVIDER=glm \
LOP_MODEL=glm-5-turbo \
LOP_API_KEY="330c0ecb926a478b87c3dbb8e7b7bb39.tdnnD7DR5u0ytzBI" \
LOP_BASE_URL="https://open.bigmodel.cn/api/anthropic" \
npx tsx benchmark/run_benchmark.ts --limit $LIMIT --concurrency $CONCURRENCY --output "benchmark/results/glm_${TIMESTAMP}.jsonl"

echo ""

# 2. Kimi
echo ">>> Running Kimi benchmark..."
LOP_PROVIDER=kimi \
LOP_MODEL=kimi-k2.5 \
LOP_API_KEY="sk-kimi-2wEjxNw32R028rILo58gFSTZS7zcdMSlbiFr3wbIzClnpWjb7TmNBGMNAIbtP0Bg" \
LOP_BASE_URL="https://api.kimi.com/coding" \
npx tsx benchmark/run_benchmark.ts --limit $LIMIT --concurrency $CONCURRENCY --output "benchmark/results/kimi_${TIMESTAMP}.jsonl"

echo ""

# 3. MiniMax
echo ">>> Running MiniMax benchmark..."
LOP_PROVIDER=minimax \
LOP_MODEL=MiniMax-M2.7 \
LOP_API_KEY="sk-cp-D8T4lQQN8hb3BzES-yqtneHGSk6xKY1xEB6wuE42QWFwkZ-B3_Phkda8nDPYIvwzfe5ysswRRByRbRkTkMVyT3V5atqWt0GiE9CJGfeLa0-8FR3mDNX0QCo" \
LOP_BASE_URL="https://api.minimaxi.com/anthropic/v1" \
npx tsx benchmark/run_benchmark.ts --limit $LIMIT --concurrency $CONCURRENCY --output "benchmark/results/minimax_${TIMESTAMP}.jsonl"

echo ""
echo "=== All benchmarks completed! ==="
echo "Results saved to benchmark/results/"
ls -la benchmark/results/*_${TIMESTAMP}.jsonl

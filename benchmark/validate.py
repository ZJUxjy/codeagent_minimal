#!/usr/bin/env python3
"""
Validate the benchmark pipeline using reference solutions from the dataset.

This runs without any API calls — it simulates model responses using
the dataset's own reference solutions and checks that the evaluator
correctly scores them.

Usage:
    python3 benchmark/validate.py
"""

import json
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))
from evaluate import evaluate_problem

DATA_FILE = os.path.join(os.path.dirname(__file__), "data", "livebench_coding.jsonl")


def main():
    with open(DATA_FILE) as f:
        problems = [json.loads(l) for l in f]

    print("Validating benchmark evaluator with reference solutions...\n")

    # coding_completion: partial_solution + remainder = correct solution
    comp_problems = [p for p in problems if p["task"] == "coding_completion" and p.get("solution")]
    comp_passed = 0
    for p in comp_problems:
        result = {
            "question_id": p["question_id"],
            "question_title": p["question_title"],
            "task": p["task"],
            "response": p.get("remainder", ""),
        }
        ev = evaluate_problem(result, p, use_private=False)
        if ev["pass"]:
            comp_passed += 1

    # LCB_generation: test that a clearly wrong answer fails
    wrong_passed = 0
    lcb_problems = [p for p in problems if p["task"] == "LCB_generation"]
    for p in lcb_problems[:10]:
        result = {
            "question_id": p["question_id"],
            "question_title": p["question_title"],
            "task": p["task"],
            "response": "```python\nclass Solution:\n    def solve(self, x):\n        return -1\n```",
        }
        ev = evaluate_problem(result, p, use_private=False)
        if not ev["pass"]:
            wrong_passed += 1  # correctly identified as wrong

    comp_rate = comp_passed / len(comp_problems) * 100 if comp_problems else 0
    wrong_rate = wrong_passed / 10 * 100

    print(f"coding_completion reference pass rate: {comp_passed}/{len(comp_problems)} = {comp_rate:.0f}%")
    print(f"  (Expected >40% since most reference solutions should pass)")
    print()
    print(f"LCB_generation wrong-answer rejection: {wrong_passed}/10 = {wrong_rate:.0f}%")
    print(f"  (Expected >80% — evaluator correctly rejects wrong answers)")
    print()

    ok = comp_rate >= 40 and wrong_rate >= 80
    if ok:
        print("✓ Evaluator pipeline validated successfully")
    else:
        print("✗ Evaluator validation FAILED — check evaluate.py")
        sys.exit(1)


if __name__ == "__main__":
    main()

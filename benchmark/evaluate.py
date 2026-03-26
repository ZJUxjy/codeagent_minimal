#!/usr/bin/env python3
"""
LiveBench Coding Benchmark Evaluator

Loads runner output (JSONL), extracts Python code from agent responses,
executes against test cases, and reports pass@1.

Usage:
    python3 benchmark/evaluate.py --results benchmark/results/model_timestamp.jsonl
    python3 benchmark/evaluate.py --results benchmark/results/model_timestamp.jsonl --use-private
    python3 benchmark/evaluate.py --results benchmark/results/*.jsonl  # compare multiple
"""

import argparse
import ast
import base64
import importlib.util
import json
import os
import pickle
import re
import sys
import tempfile
import textwrap
import traceback
import zlib
from pathlib import Path
from typing import Any


# ── Code extraction ───────────────────────────────────────────────────────────

def extract_python_code(response: str, task: str) -> str | None:
    """Extract Python code from agent response (markdown or raw)."""
    # Try ```python ... ``` blocks first
    pattern = r"```(?:python)?\s*\n(.*?)```"
    matches = re.findall(pattern, response, re.DOTALL)
    if matches:
        # Return the longest block (most likely the solution)
        return max(matches, key=len).strip()

    # For coding_completion, the response IS the completion (partial indented code).
    # Strip leading/trailing blank lines but preserve internal indentation.
    if task == "coding_completion":
        return response.strip("\n")

    # Try to find class Solution or def solution pattern
    lines = response.split("\n")
    code_lines = []
    in_code = False
    for line in lines:
        if re.match(r"^(class Solution|from typing|import )", line):
            in_code = True
        if in_code:
            code_lines.append(line)

    if code_lines:
        return "\n".join(code_lines).strip()

    # Fallback: if response looks like raw code (no prose), use it as-is
    stripped = response.strip()
    if stripped.startswith("class Solution") or stripped.startswith("def "):
        return stripped

    return None


# ── Test case decoding ────────────────────────────────────────────────────────

def decode_private_tests(encoded: str) -> list[dict]:
    """Decode private test cases: base64 → zlib → pickle → json."""
    raw = base64.b64decode(encoded)
    decompressed = zlib.decompress(raw)
    json_str = pickle.loads(decompressed)
    return json.loads(json_str)


def parse_test_cases(problem_row: dict, use_private: bool) -> list[dict]:
    tests = json.loads(problem_row["public_test_cases"])
    if use_private:
        try:
            private = decode_private_tests(problem_row["private_test_cases"])
            tests = private  # private is the superset
        except Exception:
            pass  # fall back to public
    return [t for t in tests if t.get("testtype") == "functional"]


# ── Code evaluation ───────────────────────────────────────────────────────────

def run_test_case(code: str, func_name: str, input_str: str, expected_str: str) -> tuple[bool, str]:
    """
    Execute solution code and call func_name with the parsed input.
    Returns (passed, message).
    """
    try:
        # Ensure necessary imports are available in solution
        preamble = textwrap.dedent("""\
            from typing import List, Optional, Dict, Tuple, Set
            import sys
            import math
            import collections
            from collections import defaultdict, Counter, deque
            import heapq
            import bisect
            import itertools
            import functools
        """)
        full_code = preamble + "\n" + code

        # Compile check
        try:
            compile(full_code, "<solution>", "exec")
        except SyntaxError as e:
            return False, f"SyntaxError: {e}"

        namespace: dict = {}
        exec(full_code, namespace)  # noqa: S102

        if "Solution" not in namespace:
            return False, "No Solution class found"

        solution_obj = namespace["Solution"]()
        if not hasattr(solution_obj, func_name):
            return False, f"No method {func_name}"

        func = getattr(solution_obj, func_name)

        # Parse input — may be single value or multiple args
        # Wrap in tuple to handle multiple args
        try:
            parsed_input = ast.literal_eval(input_str.strip())
        except Exception as e:
            return False, f"Bad input: {e}"

        if isinstance(parsed_input, (list, tuple)) and len(parsed_input) > 0:
            # Heuristic: if it's a list of lists/dicts, it's a single list arg
            # otherwise each element is a separate arg
            try:
                actual = func(parsed_input)
            except TypeError:
                if isinstance(parsed_input, (list, tuple)):
                    actual = func(*parsed_input)
                else:
                    return False, "Could not call function"
        else:
            actual = func(parsed_input)

        # Parse expected: try ast.literal_eval, then json.loads (handles true/false/null)
        expected_s = expected_str.strip()
        try:
            expected = ast.literal_eval(expected_s)
        except Exception:
            try:
                expected = json.loads(expected_s)
            except Exception:
                expected = expected_s

        if actual == expected:
            return True, "OK"

        # Normalize booleans: Python True/False == JSON true/false
        if isinstance(actual, bool) and isinstance(expected, bool):
            return actual == expected, "OK" if actual == expected else f"Expected {expected!r}, got {actual!r}"

        # String fallback
        if str(actual) == str(expected):
            return True, "OK"

        return False, f"Expected {expected!r}, got {actual!r}"

    except Exception:
        return False, traceback.format_exc(limit=3).strip()


def evaluate_problem(result_row: dict, problem_row: dict, use_private: bool) -> dict:
    """Evaluate a single problem result against its test cases."""
    task = result_row["task"]
    response = result_row.get("response", "")

    # Extract code
    code = extract_python_code(response, task)
    if not code:
        return {
            "question_id": result_row["question_id"],
            "question_title": result_row["question_title"],
            "task": task,
            "pass": False,
            "reason": "no_code_extracted",
            "tests_passed": 0,
            "tests_total": 0,
        }

    # For coding_completion, prepend the partial solution
    if task == "coding_completion":
        partial = problem_row.get("partial_solution", "")
        if partial and not code.startswith(partial):
            code = partial + "\n" + code

    # Get function name
    meta_str = problem_row["original_json"].get("metadata", "{}")
    try:
        meta = json.loads(meta_str)
    except Exception:
        meta = {}
    func_name = meta.get("func_name", "solve")

    # Run test cases
    tests = parse_test_cases(problem_row, use_private)
    if not tests:
        return {
            "question_id": result_row["question_id"],
            "question_title": result_row["question_title"],
            "task": task,
            "pass": False,
            "reason": "no_test_cases",
            "tests_passed": 0,
            "tests_total": 0,
        }

    passed = 0
    failures = []
    for t in tests:
        ok, msg = run_test_case(code, func_name, t["input"], t["output"])
        if ok:
            passed += 1
        else:
            failures.append(msg)

    all_passed = passed == len(tests)
    return {
        "question_id": result_row["question_id"],
        "question_title": result_row["question_title"],
        "task": task,
        "pass": all_passed,
        "reason": "ok" if all_passed else failures[0] if failures else "unknown",
        "tests_passed": passed,
        "tests_total": len(tests),
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def load_problems_by_id() -> dict[str, dict]:
    data_file = Path(__file__).parent / "data" / "livebench_coding.jsonl"
    result = {}
    with open(data_file) as f:
        for line in f:
            row = json.loads(line)
            result[row["question_id"]] = row
    return result


def evaluate_file(results_file: str, use_private: bool, verbose: bool) -> dict:
    problems = load_problems_by_id()

    results = []
    with open(results_file) as f:
        for line in f:
            results.append(json.loads(line))

    evals = []
    for r in results:
        qid = r["question_id"]
        if qid not in problems:
            print(f"  WARNING: problem {qid} not in dataset", file=sys.stderr)
            continue
        ev = evaluate_problem(r, problems[qid], use_private)
        evals.append(ev)
        if verbose:
            icon = "✓" if ev["pass"] else "✗"
            print(f"  {icon} {ev['question_title']} ({ev['tests_passed']}/{ev['tests_total']})")
            if not ev["pass"] and ev["reason"] not in ("no_code_extracted", "no_test_cases"):
                print(f"    {ev['reason'][:120]}")

    total = len(evals)
    passed = sum(1 for e in evals if e["pass"])
    by_task: dict[str, dict] = {}
    for e in evals:
        t = e["task"]
        if t not in by_task:
            by_task[t] = {"passed": 0, "total": 0}
        by_task[t]["total"] += 1
        if e["pass"]:
            by_task[t]["passed"] += 1

    model = results[0]["model"] if results else "unknown"
    return {
        "file": results_file,
        "model": model,
        "total": total,
        "passed": passed,
        "pass_at_1": round(passed / total * 100, 1) if total else 0,
        "by_task": by_task,
        "evals": evals,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--results", nargs="+", required=True, help="Results JSONL file(s)")
    parser.add_argument("--use-private", action="store_true", help="Use private test cases")
    parser.add_argument("--verbose", "-v", action="store_true", help="Show per-problem results")
    parser.add_argument("--save", help="Save evaluation results to this file")
    args = parser.parse_args()

    all_summaries = []
    for results_file in args.results:
        print(f"\nEvaluating: {results_file}")
        summary = evaluate_file(results_file, args.use_private, args.verbose)
        all_summaries.append(summary)

        test_label = "private" if args.use_private else "public"
        print(f"\n  Model:     {summary['model']}")
        print(f"  Tests:     {test_label}")
        print(f"  Pass@1:    {summary['pass_at_1']}% ({summary['passed']}/{summary['total']})")
        for task, counts in summary["by_task"].items():
            pct = round(counts["passed"] / counts["total"] * 100, 1) if counts["total"] else 0
            print(f"    {task}: {pct}% ({counts['passed']}/{counts['total']})")

    if len(all_summaries) > 1:
        print("\n── Comparison ───────────────────────────────────────")
        print(f"{'Model':<40} {'Pass@1':>8} {'Total':>6}")
        print("-" * 56)
        for s in sorted(all_summaries, key=lambda x: x["pass_at_1"], reverse=True):
            print(f"{s['model']:<40} {s['pass_at_1']:>7}% {s['total']:>6}")

    if args.save:
        with open(args.save, "w") as f:
            for s in all_summaries:
                s_out = {k: v for k, v in s.items() if k != "evals"}
                f.write(json.dumps(s_out) + "\n")
        print(f"\nSaved summary to {args.save}")


if __name__ == "__main__":
    main()

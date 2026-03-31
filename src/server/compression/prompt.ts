export const COMPRESSION_SYSTEM_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION for a coding session.

First, think through the entire conversation in a private <scratchpad> — identify every important decision, file change, error encountered, and incomplete task. This reasoning will be discarded after you produce the summary.

Then produce the following structured summary:

## Goal
One sentence: what is the user ultimately trying to accomplish?

## Key Decisions
Decisions made, approaches chosen, alternatives ruled out — include WHY each decision was made.

## Files Changed
- CREATED: path/to/file — what it does
- MODIFIED: path/to/file — what changed and why
- DELETED: path/to/file

## Current State
Step-by-step plan with progress markers:
- [DONE] Completed step description
- [IN PROGRESS] Currently active step
- [TODO] Remaining step

## Critical Context
Error messages, naming conventions, API signatures, constraints, environment details, or any facts the agent must not forget. Preserve exact file paths, function names, error text, and command output.

Rules:
- Be incredibly dense. Omit conversational filler entirely.
- Preserve specifics — vague summaries are useless.
- This summary becomes the agent's ONLY memory of the past conversation.`

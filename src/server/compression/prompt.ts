export const COMPRESSION_SYSTEM_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION for a coding session.

First, think through the entire conversation in a private <scratchpad> — identify every important decision, file change, error encountered, and incomplete task. This reasoning will be discarded after you produce the summary.

Then produce the following structured summary. Do not mention the compression or summarization process anywhere in the output — the agent receiving this summary should see it as natural context, not a meta-artifact.

## Goal
One sentence: what is the user ultimately trying to accomplish?

## Key Decisions
Decisions made, approaches chosen, alternatives ruled out — include WHY each decision was made.

## Files Changed
- CREATED: path/to/file — what it does
- MODIFIED: path/to/file — what changed and why
- DELETED: path/to/file

## Current State
This section is critical for continuity after compression. Provide a step-by-step plan with progress markers:
- [DONE] Completed step description
- [IN PROGRESS] Currently active step (be specific about what remains)
- [TODO] Remaining step

## Critical Context
Facts, constraints, and exact artifacts the agent must not forget. For key results, include the complete, exact output — do not paraphrase error messages, function signatures, command output, or configuration values. Include: file paths, function names, error text, API signatures, naming conventions, environment details.

Rules:
- Be incredibly dense. Omit conversational filler entirely.
- Write detailed, information-dense content — specific is always better than general.
- Focus on actionable, concrete information that helps reproduce or continue the work.
- This summary becomes the agent's ONLY memory of the past conversation.`

// src/commands/init/lopMdPrompt.ts

export const LOP_MD_GENERATION_PROMPT = `You are analyzing a software project to create a LOP.md file.
LOP.md is loaded automatically by the lop AI coding agent to understand this project.

Write a LOP.md that contains ONLY what a developer agent needs that cannot be discovered by reading the code.

## What to include

### Build & Dev Commands
Common commands: how to build, run tests, lint, start dev server, run a single test file.
Use the exact commands from package.json scripts, Makefile, or equivalent.

### Architecture
2-4 sentences on the high-level structure — what the major components are and how they relate.
Only include things that require reading multiple files to understand. Skip what is obvious from filenames.

### Conventions & Rules
Project-specific conventions: naming patterns, file organization rules, coding style decisions
that are not enforced by a linter. Only include what is genuinely non-obvious.

## What NOT to include
- Generic advice ("write tests", "handle errors", "never commit secrets")
- File listings or directory structure (the agent can see the files)
- Information that is already in README.md verbatim
- Obvious things like "this is a TypeScript project"

## Format
Start the file with:
\\\`\\\`\\\`
# Project Instructions
\\\`\\\`\\\`
Use ## headings. Be concise — under 400 words total.
Do not mention this generation process anywhere in the output.`;

# lop — Minimal AI Coding Agent

A lightweight, terminal-native AI coding agent. Runs locally, talks to any major LLM provider, and keeps your full conversation history across sessions.

```
┌─────────────────────────────────────────────────────────┐
│  lop  ·  anthropic/claude-sonnet-4-5  ·  session:a3f2   │
├─────────────────────────────────────────────────────────┤
│  > Refactor the auth module to use async/await          │
│                                                         │
│  Sure. I'll start by reading the current implementation │
│  ● read  src/auth/index.ts                              │
│  ● edit  src/auth/index.ts                              │
│  Done. Converted 3 callback chains to async/await and   │
│  added proper error propagation.                        │
│                                                         │
│ ╭──────────────────────────────────────╮               │
│ │ > Message or /help...                │  [+]          │
│ ╰──────────────────────────────────────╯               │
└─────────────────────────────────────────────────────────┘
```

## Features

**Core**
- Real-time streaming responses with thinking/reasoning display
- Multi-provider LLM support — Anthropic, OpenAI, Google, or any OpenAI-compatible endpoint
- Full tool use: read/write files, run bash commands, search code, glob patterns
- MCP (Model Context Protocol) support — plug in any MCP-compatible tool server

**Sessions**
- Conversations persist across restarts — resume where you left off
- `/sessions` lists all past sessions with timestamps, message counts, and previews
- `/load`, `/rename`, `/delete` for full session management
- `--resume` flag to auto-load the most recent session on startup

**Terminal UI**
- Built with React + Ink — responsive, adapts to terminal size
- Three themes: `dark`, `light`, `ansi`
- Large paste detection — pasting hundreds of lines shows a compact placeholder; full content is sent to the LLM on submit
- Emacs-style keybindings (Ctrl+A/E/K/U/W, Meta+F/B)
- Slash command autocomplete

## Quick Start

```bash
# Install dependencies
npm install

# Set your API key
export LOP_API_KEY=sk-ant-...          # Anthropic (default)
# export LOP_API_KEY=sk-...            # OpenAI
# export LOP_API_KEY=...               # Google

# Run in development mode
npm run dev

# Or build and run
npm run build && npm start
```

## CLI Options

```
lop [options]

  -p, --provider <name>     LLM provider: anthropic | openai | google
  -m, --model <name>        Model name (e.g. claude-sonnet-4-5)
  -d, --directory <path>    Working directory for the agent (default: cwd)
      --theme <name>        UI theme: dark | light | ansi
  -r, --resume              Auto-resume the most recent session
```

## Configuration

lop looks for a config file by walking up from the current directory, then checking `$HOME`. Supported filenames: `config.json`, `lop.config.json`, `.lop.config.json`.

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "apiKey": "sk-ant-...",
  "mcpServers": {
    "my-tools": {
      "command": "node",
      "args": ["path/to/mcp-server.js"]
    }
  },
  "persistence": {
    "enabled": true,
    "maxAgeDays": 30,
    "maxSessions": 100
  }
}
```

**Environment variables** (override config file):

| Variable | Description |
|---|---|
| `LOP_PROVIDER` | `anthropic` \| `openai` \| `google` |
| `LOP_MODEL` | Model name |
| `LOP_API_KEY` | API key |
| `LOP_BASE_URL` | Custom API base URL |
| `LOP_THEME` | `dark` \| `light` \| `ansi` |
| `LOP_DEBUG` | Enable debug logging (`true` / `1`) |

## Built-in Commands

| Command | Alias | Description |
|---|---|---|
| `/help` | | List all available commands |
| `/clear` | | Clear the current conversation |
| `/quit` | `/exit` | Exit the application |
| `/sessions` | `/list` | List saved sessions |
| `/load [id]` | | Resume a session by ID prefix |
| `/rename <id> <title>` | `/title` | Name a session |
| `/delete <id>` | | Delete a session |
| `/stats` | | Show tool usage statistics |
| `/theme [name]` | | Switch UI theme |
| `/mcp list` | | List active MCP servers and tools |
| `/mcp reload` | | Reload MCP server connections |

## Agent Tools

The agent can use these tools during a conversation:

| Tool | Description |
|---|---|
| `bash` | Run shell commands in the working directory |
| `read` | Read file contents |
| `write` | Write or overwrite a file |
| `edit` | Replace a specific string within a file |
| `glob` | Find files by pattern |
| `grep` | Search file contents with regex |
| `listDirectory` | List directory contents |
| `askQuestion` | Prompt the user for clarification |
| MCP tools | Dynamically loaded from configured MCP servers |

## Architecture

lop uses a **client-server split over stdin/stdout**:

```
Terminal UI (React + Ink)
       |
   JSON-RPC 2.0
       |
  Agent Server (subprocess)
  ├── LLM client (ai SDK)
  ├── Tool registry
  ├── Session store (JSONL files)
  └── MCP client manager
```

The TUI spawns the agent server as a child process and communicates with it via JSON-RPC. This keeps UI logic and agent logic fully isolated — the server can be run standalone for debugging, and the client can be replaced without touching the agent.

Sessions are stored as JSONL files under `~/.lop/sessions/<dir-hash>/`, with a fast `index.json` metadata cache for O(1) session listing.

## Development

```bash
npm run dev      # Run with tsx (no build step)
npm run build    # Compile TypeScript → dist/
npm run test     # Run tests with vitest
npm run server   # Run the agent server directly (for debugging)
```

## Requirements

- Node.js ≥ 20.0.0
- A terminal with bracketed paste mode support (most modern terminals)
- An API key for at least one supported LLM provider

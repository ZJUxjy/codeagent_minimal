# MCP 模块（对标 qwen-code）Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** 在 `lop_minimal` 中落地一个可用的 MCP 模块（stdio/http/sse + 工具发现 + 调用 + 最小化管理能力），并保持当前极简架构可维护。

**Architecture:** 采用 `qwen-code` 的“分层设计”但做最小实现：`配置层`（mcpServers）→ `传输层`（transport factory）→ `连接层`（McpClient）→ `管理层`（McpClientManager）→ `工具适配层`（DiscoveredMcpTool 注入 ToolRegistry）。第一阶段不实现 OAuth 动态注册与复杂 UI，只预留接口和错误模型，遵循 DRY/YAGNI。

**Tech Stack:** TypeScript、Zod、`@modelcontextprotocol/sdk`、Vitest（新增）

---

## qwen-code MCP 详细调研结论（用于本计划设计依据）

1. **主流程是可分层的**
   - 核心入口是 `packages/core/src/tools/tool-registry.ts`，通过 `McpClientManager` 统一发现/重连/销毁。
   - `McpClient` 负责单 server 生命周期（connect/discover/disconnect/readResource）。
   - `mcp-tool.ts` 做“协议结果 -> LLM 可消费结果”的适配，并处理错误、进度、截断。

2. **qwen-code 关键工程实践**
   - **Transport 工厂统一分发：** stdio / sse / http 都走 `createTransport`。
   - **配置驱动发现：** `mcpServers` + `includeTools/excludeTools` + 全局 allow/exclude。
   - **生命周期完整：** 全量发现、单 server 重发现、健康检查、断线重连、stop 幂等。
   - **工具命名规范：** `mcp__<server>__<tool>`，并做长度/字符合法化。
   - **权限与安全：** readOnlyHint、trust、目录信任（trusted folder）协同。
   - **测试矩阵完整：** 单元（命名/错误/中断/进度）+ 集成（真实 MCP server）。

3. **对 lop_minimal 的约束映射**
   - 当前 `Tool` 接口返回 `Promise<string>`，无法原生承载富媒体；第一阶段将 MCP 内容归一化为文本（保留后续扩展点）。
   - 当前仓库无测试框架；要先引入 Vitest，否则无法做 TDD。
   - 当前配置只有 provider/model/apiKey/baseURL；要补 `mcpServers` 与最小全局开关。

4. **MVP 范围（本计划落地）**
   - 支持 `stdio/http/sse` 连接。
   - 启动时自动发现并注册 MCP tools。
   - 支持 `includeTools/excludeTools`。
   - 支持断开与重发现（手动触发 API）。
   - 提供最小 `/mcp` 可观测命令（list/reload）。

5. **非目标（明确不做）**
   - 不做 OAuth 自动发现/动态注册（仅预留配置与错误提示）。
   - 不做 TUI 图形管理面板。
   - 不做资源下载到文件系统（先仅文本化展示）。

---

### Task 1: 测试基线与依赖准备

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/server/mcp/__tests__/bootstrap.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"

describe("mcp bootstrap", () => {
  it("sanity: test runner works", () => {
    expect(false).toBe(true)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/server/mcp/__tests__/bootstrap.test.ts`
Expected: FAIL with `expected false to be true`

**Step 3: Write minimal implementation**

```ts
// src/server/mcp/__tests__/bootstrap.test.ts
import { describe, it, expect } from "vitest"

describe("mcp bootstrap", () => {
  it("sanity: test runner works", () => {
    expect(true).toBe(true)
  })
})
```

并在 `package.json` 增加：

```json
{
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^2.0.0"
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/bootstrap.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json vitest.config.ts src/server/mcp/__tests__/bootstrap.test.ts
git commit -m "test: bootstrap vitest for upcoming MCP module TDD"
```

---

### Task 2: MCP 配置模型（对齐 qwen-code 的最小子集）

**Files:**
- Modify: `src/protocol/types.ts`
- Modify: `src/config.ts`
- Test: `src/server/mcp/__tests__/config.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { parseMcpConfig } from "../config.js"

describe("parseMcpConfig", () => {
  it("parses stdio/http/sse servers", () => {
    const cfg = parseMcpConfig({
      mcpServers: {
        fs: { command: "node", args: ["server.js"] },
        api: { httpUrl: "http://localhost:3000/mcp" },
        legacy: { url: "http://localhost:4000/sse" }
      }
    })
    expect(Object.keys(cfg.mcpServers ?? {})).toEqual(["fs", "api", "legacy"])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/config.test.ts`
Expected: FAIL with `parseMcpConfig is not defined`

**Step 3: Write minimal implementation**

```ts
// src/protocol/types.ts
export interface McpServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  httpUrl?: string
  url?: string
  headers?: Record<string, string>
  timeout?: number
  includeTools?: string[]
  excludeTools?: string[]
}

export interface LopConfig {
  // ...existing
  mcpServers?: Record<string, McpServerConfig>
  mcp?: { allowed?: string[]; excluded?: string[] }
}
```

```ts
// src/config.ts
export function parseMcpConfig(raw: Record<string, unknown>): LopConfig {
  // zod 校验 + 默认值归一化，非法 server 直接丢弃并告警
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/protocol/types.ts src/config.ts src/server/mcp/__tests__/config.test.ts
git commit -m "feat: add MCP configuration schema and parser"
```

---

### Task 3: 传输层工厂（stdio/http/sse）

**Files:**
- Create: `src/server/mcp/transport.ts`
- Test: `src/server/mcp/__tests__/transport.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { createMcpTransport } from "../transport.js"

describe("createMcpTransport", () => {
  it("creates stdio transport when command exists", async () => {
    const transport = await createMcpTransport("fs", { command: "node", args: ["x.js"] })
    expect(transport).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/transport.test.ts`
Expected: FAIL with `createMcpTransport is not defined`

**Step 3: Write minimal implementation**

```ts
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

export async function createMcpTransport(serverName: string, cfg: McpServerConfig) {
  if (cfg.command) return new StdioClientTransport({ command: cfg.command, args: cfg.args ?? [], env: cfg.env, cwd: cfg.cwd })
  if (cfg.httpUrl) return new StreamableHTTPClientTransport(new URL(cfg.httpUrl), { requestInit: { headers: cfg.headers } })
  if (cfg.url) return new SSEClientTransport(new URL(cfg.url), { requestInit: { headers: cfg.headers } })
  throw new Error(`Invalid MCP server '${serverName}': missing command/httpUrl/url`)
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/transport.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/mcp/transport.ts src/server/mcp/__tests__/transport.test.ts
git commit -m "feat: add MCP transport factory for stdio/http/sse"
```

---

### Task 4: 单 server 客户端（连接、发现、断开）

**Files:**
- Create: `src/server/mcp/client.ts`
- Test: `src/server/mcp/__tests__/client.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { McpClient } from "../client.js"

describe("McpClient", () => {
  it("rejects discover when not connected", async () => {
    const c = new McpClient("x", { command: "node", args: ["srv.js"] })
    await expect(c.discoverTools()).rejects.toThrow("not connected")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/client.test.ts`
Expected: FAIL (class not found)

**Step 3: Write minimal implementation**

```ts
export class McpClient {
  // connect() -> Client.connect(transport)
  // discoverTools() -> listTools + include/exclude filter
  // disconnect() -> transport.close + client.close
}
```

最小要求：
- 状态枚举：`disconnected | connecting | connected`
- `discoverTools()` 返回 `{ serverName, toolName, description, inputSchema }[]`
- 若 `includeTools/excludeTools` 同时命中，`exclude` 优先

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/mcp/client.ts src/server/mcp/__tests__/client.test.ts
git commit -m "feat: implement MCP single-server client lifecycle and discovery"
```

---

### Task 5: MCP Tool 适配器（接入现有 Tool 接口）

**Files:**
- Create: `src/server/tools/mcpTool.ts`
- Modify: `src/server/tools/types.ts`
- Test: `src/server/mcp/__tests__/mcp-tool.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { createMcpToolName } from "../../tools/mcpTool.js"

describe("createMcpToolName", () => {
  it("creates qualified name", () => {
    expect(createMcpToolName("browser", "navigate")).toBe("mcp__browser__navigate")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/mcp-tool.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// src/server/tools/mcpTool.ts
export function createMcpToolName(server: string, tool: string): string {
  return `mcp__${server}__${tool}`.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

export function createDiscoveredMcpTool(/* ... */): Tool {
  return {
    name: createMcpToolName(serverName, toolName),
    description: `${toolName} (${serverName} MCP Server)`,
    parameters: z.object({}).passthrough(),
    async execute(params, ctx) {
      // callTool -> 将 MCP content block 归一化为字符串（text/resource_link 优先）
      // 错误统一返回 Error: 前缀文本
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/mcp-tool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/tools/mcpTool.ts src/server/tools/types.ts src/server/mcp/__tests__/mcp-tool.test.ts
git commit -m "feat: add MCP tool adapter with qualified naming and execution bridge"
```

---

### Task 6: McpClientManager + ToolRegistry 动态发现集成

**Files:**
- Create: `src/server/mcp/clientManager.ts`
- Modify: `src/server/tools/index.ts`
- Modify: `src/server/agent.ts`
- Test: `src/server/mcp/__tests__/manager.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"
import { ToolRegistry } from "../../tools/index.js"

describe("ToolRegistry MCP integration", () => {
  it("registers discovered MCP tools", async () => {
    const registry = new ToolRegistry(/* with mock mcp config */)
    await registry.discoverMcpTools()
    expect(registry.get("mcp__demo__add")).toBeDefined()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/manager.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// clientManager.ts
export class McpClientManager {
  async discoverAll() {}
  async discoverOne(serverName: string) {}
  async stop() {}
}
```

```ts
// tools/index.ts
export class ToolRegistry {
  // 新增 discoverMcpTools() 与 removeMcpToolsByServer()
  // 构造时保留核心工具注册逻辑
}
```

`Agent` 初始化时注入 `LopConfig`（含 mcpServers），在首次运行前触发一次 MCP 发现。

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/manager.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/server/mcp/clientManager.ts src/server/tools/index.ts src/server/agent.ts src/server/mcp/__tests__/manager.test.ts
git commit -m "feat: integrate MCP client manager with tool registry discovery"
```

---

### Task 7: 最小运维能力（list/reload）与 JSON-RPC 扩展

**Files:**
- Modify: `src/protocol/types.ts`
- Modify: `src/server/index.ts`
- Modify: `src/client/index.ts`
- Create: `src/commands/builtin/mcpCommand.ts`
- Modify: `src/commands/builtin/index.ts`
- Test: `src/server/mcp/__tests__/rpc-mcp.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"

describe("MCP RPC", () => {
  it("supports mcp_list request", async () => {
    // 发 JSON-RPC: { method: "mcp_list" }
    // 期望返回 server 状态数组
    expect(true).toBe(false)
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/rpc-mcp.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```ts
// server/index.ts 新增 method:
// - mcp_list: 返回 [{ name, status, transport }]
// - mcp_reload: 触发 manager.discoverAll()
```

```ts
// /mcp 命令子命令：
// /mcp list
// /mcp reload
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/rpc-mcp.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/protocol/types.ts src/server/index.ts src/client/index.ts src/commands/builtin/mcpCommand.ts src/commands/builtin/index.ts src/server/mcp/__tests__/rpc-mcp.test.ts
git commit -m "feat: add minimal MCP management RPC and slash command"
```

---

### Task 8: 文档与端到端验证

**Files:**
- Create: `docs/mcp-design.md`
- Modify: `README.md`
- Create: `examples/mcp/addition-server.cjs`
- Create: `src/server/mcp/__tests__/integration.simple-mcp.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest"

describe("simple mcp integration", () => {
  it("discovers and executes add tool", async () => {
    expect("TODO").toBe("15")
  })
})
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/server/mcp/__tests__/integration.simple-mcp.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

参考 qwen-code `integration-tests/simple-mcp-server.test.ts` 思路，提供最小 JSON-RPC MCP server fixture，验证：
- server 启动后能被发现；
- `mcp__addition-server__add` 被调用；
- 返回结果包含 `15`。

**Step 4: Run test to verify it passes**

Run: `npm test -- src/server/mcp/__tests__/integration.simple-mcp.test.ts && npm run build`
Expected: 全部 PASS，TypeScript build 成功

**Step 5: Commit**

```bash
git add docs/mcp-design.md README.md examples/mcp/addition-server.cjs src/server/mcp/__tests__/integration.simple-mcp.test.ts
git commit -m "docs: add MCP usage guide and integration test fixture"
```

---

## 验收清单（Definition of Done）

- `mcpServers` 可从配置文件正确读取并校验。
- 支持 stdio/http/sse 三种传输并可连接至少一个真实 server。
- MCP tools 成功注入 `ToolRegistry`，命名遵循 `mcp__server__tool`。
- `includeTools/excludeTools` 生效，且 `exclude` 优先。
- 支持 `mcp_list` / `mcp_reload`（或等价管理能力）。
- 单元测试 + 最小集成测试通过，`npm run build` 通过。

## 风险与回退策略

- **风险 1（协议差异）**：部分 MCP server 只实现旧版 schema。  
  **回退**：对 `listTools/callTool` 加兼容分支，不阻塞主流程。
- **风险 2（长耗时调用）**：当前 Tool 接口是字符串返回，不支持流式进度。  
  **回退**：先保证最终结果可达，第二期再升级 ToolResult 结构。
- **风险 3（安全边界）**：MCP 工具权限语义不清晰。  
  **回退**：默认走现有 hook 审批，全部按 `ask` 处理。

## 第二期（不在本计划执行）

- OAuth 自动发现与认证（参考 qwen-code `oauth-provider.ts`）。
- MCP resources/read 与二进制下载能力。
- TUI MCP 管理面板（server 状态、授权、重连）。


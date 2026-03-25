# Subagent（子代理）支持 Implementation Plan

> **For Claude:** Use `${SUPERPOWERS_SKILLS_ROOT}/skills/collaboration/executing-plans/SKILL.md` to implement this plan task-by-task.

**Goal:** 在 lop_minimal 中实现与 qwen-code 同构思想的「主代理通过工具委派子代理」能力：可配置的子代理人设/工具子集、主会话内一次阻塞调用、结果以工具返回值合并回主对话。

**Architecture:** qwen-code 将子代理定义为带 YAML frontmatter 的 Markdown（`SubagentManager` 负责加载/合并优先级），并通过名为 `Agent` 的 LLM 工具在**同一进程**内实例化 `AgentHeadless`（共享 `Config`，独立 prompt/工具/运行参数与消息上下文），执行完成后把最终文本作为工具结果交给主代理。lop_minimal 已有 `Agent` 多轮循环与 `ToolRegistry`，计划用**第二个 `Agent` 实例 + 独立 `InMemoryStore`** 实现子运行，子实例共享 LLM 与 `cwd` 配置；通过**工具白名单**构造子集工具定义；**默认不向子代理注册 `agent` 工具**以防无界递归。第一阶段不实现 qwen 的 SubagentStart/Stop hooks 与实时 UI 流式 nested 事件，仅返回汇总字符串；第二阶段可扩展协议与 TUI。

**Tech Stack:** TypeScript (ESM)、Vercel AI SDK `streamText`、`zod`、`vitest`；可选依赖 `yaml`（与 qwen 一致解析 frontmatter）。

**参考技能:** @skills/writing-plans @skills/systematic-debugging @skills/verification-before-completion

---

## 调研摘要：qwen-code 如何做 subagent

以下路径均在仓库 `/home/xjingyao/code/agent/qwen-code`（若你本地路径不同，只替换根目录）。

| 能力 | 主要文件 | 行为 |
|------|-----------|------|
| 子代理定义（文件） | `packages/core/src/subagents/types.ts` | `name`、`description`、`tools?`、`systemPrompt`（正文）、`modelConfig?`、`runConfig?`、`level` 等 |
| 加载与 CRUD | `packages/core/src/subagents/subagent-manager.ts` | `.qwen/agents/`（项目）、`~/.qwen/agents/`（用户）、builtin、extension、session；合并时同名**高优先级覆盖**；Markdown + YAML frontmatter |
| 内置子代理 | `packages/core/src/subagents/builtin-agents.ts` | 如 `general-purpose`、`Explore`（只读探索） |
| LLM 可见工具 | `packages/core/src/tools/agent.ts` | `AgentTool`：`description`、`prompt`、`subagent_type`；**动态**把可用 `subagent_type` 写入 schema `enum` 与工具描述列表 |
| 运行时 | `packages/core/src/subagents/subagent-manager.ts` → `createAgentHeadless` | `AgentHeadless.create(...)`，**非独立子进程**（工具文案中写「subprocess」但实现是 headless 运行时） |
| 执行 | `packages/core/src/agents/runtime/agent-headless.ts` | `execute(contextState, signal)`，独立消息与 `AgentCore` 循环；`${var}` 由 `ContextState` 做模板替换 |
| 主会话提示 | `packages/core/src/core/client.ts` | 若存在用户自定义 subagent，注入 system reminder 提醒主模型可使用 Agent 工具 |
| Hooks | `packages/core/src/hooks/hookSystem.ts` | `SubagentStart` / `SubagentStop`（策略与上下文注入） |

**与 lop_minimal 的对照**

- lop 无 `AgentHeadless` / `AgentCore`，但有 `src/server/agent.ts` 的 `Agent.run` + `LLMClient.stream`，可直接复用。
- lop 协议为 JSON-RPC `content` / `tool_call` / `tool_result` / `done`（见 `src/protocol/types.ts`）；子代理内部 tool 调用若需展示，要么只在 Phase 1 **折叠**进最终字符串，要么 Phase 2 增加 `subagent_*` 通知。
- lop 的 `Tool.execute` 签名为同步 `Promise<string>`，适合把子代理运行封装为「长时间运行的工具」。

---

## 设计决策（落地约束）

1. **工具名**：建议使用 `agent`（与生态心智一致）。若避免与类名 `Agent` 混淆，可在代码里导出 `agentTool`，`name: "agent"`。
2. **子代理配置目录**：`<cwd>/.lop/agents/*.md` 与 `~/.lop/agents/*.md`（与现有 `~/.lop/debug/` 家族一致），builtin 写在 `src/server/subagents/builtin.ts`。
3. **优先级**：`session`（若日后支持）> `project` > `user` > `builtin`（与 qwen 类似，v1 可实现 project/user/builtin）。
4. **递归**：子代理**默认**工具列表不包含 `agent`；若某子代理 YAML 显式包含 `"agent"` 且未来支持，再加 **最大深度**（如 `SUBAGENT_MAX_DEPTH=2`）。
5. **中断**：`Agent.run(..., signal)` 已存在中断路径；子代理 `run` 必须传入**同一** `AbortSignal`。
6. **MCP**：v1 子代理或与主代理共享全部已发现的 MCP 工具，或遵循 YAML `tools` 列表过滤（列表为空表示全量）；与 qwen 的 `tools` 省略=继承一致。
7. **模型**：v1 子代理继承主会话的 provider/model；可选后续在 frontmatter 增加 `modelConfig` 覆盖（非必须，YAGNI 可先不做）。

---

### Task 1: 依赖与类型基线

**Files:**
- Modify: `package.json`（如采用 `yaml` 包）
- Create: `src/server/subagents/types.ts`
- Test: `src/server/subagents/types.test.ts`（可选：仅导出类型则无测试，可跳过）

**Step 1: 添加 YAML 解析依赖**

```bash
npm add yaml
```

**Step 2: 定义 `SubagentLevel`、`SubagentConfig`**

与 qwen `types.ts` 对齐最小字段：`name`、`description`、`systemPrompt`、`level`、`tools?: string[]`、`filePath?: string`、`isBuiltin?: boolean`。

**Step 3: 提交**

```bash
git add package.json package-lock.json src/server/subagents/types.ts
git commit -m "chore(subagent): add types and yaml dependency"
```

---

### Task 2: Frontmatter 解析与校验

**Files:**
- Create: `src/server/subagents/parse.ts`（`parseSubagentMarkdown(content: string): SubagentConfig`）
- Create: `src/server/subagents/validation.ts`（`name`/`description`/`systemPrompt` 非空）
- Test: `src/server/subagents/parse.test.ts`

**Step 1: 写失败测试**

```typescript
import { describe, it, expect } from 'vitest'
import { parseSubagentMarkdown } from './parse.js'

it('rejects missing frontmatter', () => {
  expect(() => parseSubagentMarkdown('no frontmatter')).toThrow()
})
```

**Step 2: 运行测试**

Run: `npm test -- src/server/subagents/parse.test.ts`

Expected: FAIL（parse 未实现）

**Step 3: 实现解析**

- 使用 `---` 分隔；`yaml` 解析第一段；正文为 `systemPrompt.trim()`。
- `name`、`description` 来自 YAML；`tools` 可选数组。

**Step 4: 再跑测试**

Expected: PASS

**Step 5: 提交**

```bash
git add src/server/subagents/
git commit -m "feat(subagent): parse markdown agent definitions"
```

---

### Task 3: SubagentManager（列出与加载）

**Files:**
- Create: `src/server/subagents/builtin.ts`（至少一个 `explore` 只读风格或 `general-purpose`，内容与 lop 工具名 `read`/`grep`/`glob` 对齐）
- Create: `src/server/subagents/manager.ts`
- Test: `src/server/subagents/manager.test.ts`

**Step 1: 写测试用例（临时目录 fixture）**

在测试中 `mkdir` 项目目录，写入 `.lop/agents/foo.md`，调用 `listSubagents(projectRoot)`，期望包含 `foo` 且 description 正确。

**Step 2: 实现 `SubagentManager`**

- `async listSubagents(cwd: string): Promise<SubagentConfig[]>`：合并 builtin、用户目录、项目目录；**project 覆盖 user 同名**。
- `async loadByName(cwd: string, name: string): Promise<SubagentConfig | null>`：大小写不敏感查找。

**Step 3: 运行**

Run: `npm test -- src/server/subagents/manager.test.ts`

Expected: PASS

**Step 4: 提交**

```bash
git add src/server/subagents/
git commit -m "feat(subagent): load agents from .lop/agents and ~/.lop/agents"
```

---

### Task 4: 工具子集工厂

**Files:**
- Create: `src/server/subagents/toolFilter.ts`
- Test: `src/server/subagents/toolFilter.test.ts`

**Step 1: 测试**

给定 `tools: ['read', 'grep']` 与主注册表含 `read`、`write`、`bash`，`filterToolDefinitions(registry, names)` 只返回前两者定义。

**Step 2: 实现**

若 `tools` 未定义或为空数组，返回**全部**（与 qwen 语义一致：省略 = 全量）。

**Step 3: 提交**

```bash
git add src/server/subagents/toolFilter.ts src/server/subagents/toolFilter.test.ts
git commit -m "feat(subagent): filter tool definitions by allowlist"
```

---

### Task 5: 子代理运行器（核心）

**Files:**
- Create: `src/server/subagents/runChildAgent.ts`
- Modify: `src/server/agent.ts`（仅当需要抽取可复用构造函数参数时；否则保持最少改动）

**Step 1: 写集成式单元测试（mock LLM）**

lop 当前 LLM 未抽象为接口，测试可选方案：

- **方案 A（推荐）**: 使用 `vi.spyOn(LLMClient.prototype, 'stream')` 返回单轮无 tool 的 async generator，断言 `runChildAgent` 最终字符串。
- **方案 B**: 提取 `LLMClient` 接口仅用于测试（改动较大，非首选）。

在 `src/server/subagents/runChildAgent.test.ts` 中验证：子代理收到 `system` + `user` 消息结构正确（`getAll()` 或 spy 捕获 `stream` 的 `messages` 参数）。

**Step 2: 实现 `runChildAgent`**

签名示例：

```typescript
export async function runChildAgent(options: {
  parentAgent: Agent // 或传入 LLMClient + cwd + hooks + mcp 配置
  subagent: SubagentConfig
  taskPrompt: string
  signal?: AbortSignal
}): Promise<string>
```

内部：

1. `new LLMClient` 与父级相同配置（从父 `Agent` 需增加 getter 或传入 `AgentConfig` 快照）。
2. `new ToolRegistry(mcpOptions)` 并 `discoverMcpTools`（与父一致）；注册与父级相同核心工具；**过滤** `tools`。
3. `new InMemoryStore()`；`store.add({ role: 'system', content: subagent.systemPrompt })`；`store.add({ role: 'user', content: taskPrompt })`。
4. `new Agent({ ...config, store })` — 若当前 `Agent` 构造函数不暴露复制入口，则提取 `buildAgentConfig()` 工厂（**最小改动**：给 `Agent` 增加 `static fromParent(parent, overrides)` 或把配置字段设为可选覆盖）。

5. **consume** `agent.run` 生成器直到 `done`，忽略向外的 `yield`（工具结果仅进子 store）；返回最后一轮聚合的 assistant 文本（需在 `run` 结束後从 `store.getAll()` 取最后一条 assistant 的 `content` 字符串）。

**Step 3: 运行测试**

Run: `npm test -- src/server/subagents/runChildAgent.test.ts`

**Step 4: 提交**

```bash
git add src/server/subagents/runChildAgent.ts src/server/agent.ts src/server/subagents/runChildAgent.test.ts
git commit -m "feat(subagent): run isolated child agent with own store"
```

---

### Task 6: `agent` 工具注册与动态描述

**Files:**
- Create: `src/server/tools/agent.ts`
- Modify: `src/server/tools/index.ts` 或 `src/server/index.ts`（服务器创建 `Agent` 处）：在构造 `ToolRegistry` **之后**、`discoverMcpTools` **之后**注册 `createAgentTool(cwd, parentAgentRef)`  
- Modify: `src/server/agent.ts`：若工具需要回调父实例，采用**延迟绑定**：`register(createAgentTool(() => this))` 在 `Agent` 构造末尾调用 `initAgentTool()`（避免构造函数循环引用）。

**工具 schema（zod）**

```typescript
const AgentToolParams = z.object({
  description: z.string().min(1),
  prompt: z.string().min(1),
  subagent_type: z.string().min(1),
})
```

**execute 逻辑**

1. `SubagentManager.loadByName(cwd, subagent_type)`；找不到返回错误字符串 `isError` 由 tool 层统一包装（lop 当前返回 `Error: ...` 字符串）。
2. `runChildAgent({ ... })`；返回最终报告字符串。
3. 工具描述中列举 `listSubagents` 的 name + description（**每次 execute 前刷新**或在 `listSubagents` 变更不频繁时缓存 + `mtime`；v1 可每次都 `list`）。

**Step 1: 写测试**

Mock `runChildAgent`，断言 `execute` 被传入正确 `subagent_type`。

**Step 2: 实现并跑 `npm test`**

**Step 3: 提交**

```bash
git add src/server/tools/agent.ts src/server/tools/index.ts src/server/agent.ts
git commit -m "feat(tools): add agent delegation tool"
```

---

### Task 7: 主会话 system 提示（可选但低成本）

**Files:**
- Modify: `src/server/agent.ts` 在 `run` 开始时，若注册表中存在 `agent` 工具，于**第一条** user 消息之前确保有一条 `system` 说明（或合并入单次 chat 的隐式 prefix）：列出可用子代理名称。

qwen 在 `client.ts` 使用 `getSubagentSystemReminder`。lop 可实现 `buildSubagentReminder(cwd)` 返回一段短文，**prepend 到本轮 LLM 请求前**需注意：当前架构只有 `store` 无单独 system，可：

- 在 `store.getAll()` 前插入 `{ role: 'system', content: reminder }` 仅本轮有效并在结束后移除（会污染 store），或
- 扩展 `LLMClient.stream` 接受 `system?: string`（更清晰，**推荐**小改 `llm.ts`：`stream(messages, tools, options?)`）。

**Step 1: 扩展 `LLMClient.stream` 可选 `system` 参数**，并传参 `streamText({ system, messages, ... })`。

**Step 2: 在 `Agent.run` 中若存在子代理配置，计算 reminder 字符串，仅传给 `stream`，**不写进 store**。

**Step 3: 测试**：对 `LLMClient.stream`  spy 断言 `streamText` 收到 `system`。

**Step 4: 提交**

```bash
git add src/llm.ts src/server/agent.ts src/llm.test.ts
git commit -m "feat(llm): optional system prompt for subagent reminders"
```

---

### Task 8: 端到端冒烟与安全

**Files:**
- Modify: `src/server/security/policy.ts`（若需将 `agent` 纳入策略）
- Manual: 在项目根创建 `.lop/agents/demo.md`

**Step 1: 策略**  

确认 `evaluateToolPolicy('agent', ...)` 不致默认 deny；必要时加入 `agent` 规则文档。

**Step 2: 本地运行**

```bash
LOP_DEBUG=1 npm run dev
```

在 TUI 中让用户输入：「使用 agent 工具调用 demo 子代理，总结 `src/index.ts`」。观察 `tool_call` / `tool_result`。

**Step 3: 全量测试**

Run: `npm test`

Expected: 全部 PASS

**Step 4: 提交**

```bash
git add src/server/security/
git commit -m "fix(security): allow agent tool under default policy"
```

---

### Task 9（可选 Phase 2）: 子代理流式事件

**Files:**
- Modify: `src/protocol/types.ts` — 新增 `subagent_content` / `subagent_tool_call` 通知
- Modify: `src/client/index.ts`、`src/tui/App.tsx` — 嵌套缩进展示

仅在产品有明确需求时做；计划评审通过后再开分支。

---

## 验收标准

- 存在至少一个 builtin + 可从 `.lop/agents/*.md` 加载的自定义子代理。
- 主模型可通过 `agent` 工具委派任务并收到子代理最终文本。
- 子代理默认不能调用 `agent`（或受深度限制）；Ctrl+C / interrupt 能终止子代理内 LLM 循环。
- `npm run build` 与 `npm test` 通过。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| `Agent` 构造与 `agent` 工具循环依赖 | 延迟注册或工厂 `createAgentTool(getParent: () => Agent)` |
| 子代理与主会话共享 MCP 状态 | v1 每实例独立 `ToolRegistry`；MCP 连接可能翻倍 | 文档说明；后续可共享 `McpClientManager` |
| Token 成本翻倍 | 子代理用较短 `maxTurns`（lop 主循环已是 10；可为子代理设 5） |
| `streamText` maxSteps 与 Agent 外层循环双重限制 | 保持现状；子代理内层 `maxSteps` 与外层一致或更小 |

---

## 执行交接说明

本计划假设执行者**零仓库上下文**，所有路径相对于 `lop_minimal` 根目录。

详细命令与提交信息已逐 Task 给出；实现时遵守 **DRY / YAGNI / TDD / 小步提交**。

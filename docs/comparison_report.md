# AI 编码助手功能对比报告

**调查日期**: 2026-03-30
**最后更新**: 2026-03-30 (代码核实修正)
**调查对象**: lop_minimal vs codex vs qwen-code vs opencode

---

## 1. 概述

本报告对比分析了四个 AI 编码助手项目的功能差异，帮助了解各项目的优劣势和发展方向。

| 项目 | 开发方 | 语言/运行时 | 定位 |
|-----|--------|------------|------|
| **lop_minimal** | 内部项目 | TypeScript/Node | 极简架构的 AI 编码助手 |
| **codex** | OpenAI | Rust | 官方 CLI 工具 |
| **qwen-code** | 阿里云/Qwen | TypeScript/Node | 开源终端 AI 助手 |
| **opencode** | AnomalyCo | TypeScript/Bun | 开源 Claude Code 替代方案 |

---

## 2. 架构对比

| 维度 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **架构模式** | Client-Server (JSON-RPC over stdio) | 单体内核 + TUI/exec | Monolith | Client-Server (HTTP/WebSocket) |
| **TUI 框架** | Ink (React) | Ratatui | Ink (React) | OpenTUI (SolidJS) |
| **LLM SDK** | Vercel AI SDK | OpenAI API | OpenAI/Anthropic SDK | Vercel AI SDK |
| **持久化** | JSONL + SessionIndex | Session rollout files | SQLite | SQLite + Drizzle ORM |

### 2.1 架构特点分析

**lop_minimal**
- 轻量级 Client-Server 架构，客户端通过 JSON-RPC 2.0 与服务器通信
- 服务器运行在独立进程中，支持中断和恢复
- JSONL 文件持久化 + SessionIndex 索引，支持会话加载/删除/重命名

**codex**
- Rust 实现的单体架构，分为 core、tui、exec 三个主要 crate
- 支持 headless 模式 (`codex exec`) 用于自动化场景

**qwen-code**
- npm workspace 管理的 monorepo
- CLI 和 Core 分离，支持 IDE 插件扩展

**opencode**
- 真正的 Client-Server 分离架构，可远程驱动
- 本地 HTTP 服务器提供 REST/WebSocket API
- 支持 Desktop App (Tauri) 和 Web UI

---

## 3. LLM 支持对比

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **支持提供商** | 7个 | 1个 (OpenAI) | 4+ | 20+ |
| **OAuth 集成** | ❌ | ❌ | ✅ Qwen OAuth | ✅ 多提供商 |
| **本地模型** | ❌ | ❌ | ✅ | ✅ |
| **配置格式** | config.json | config.toml | settings.json | 分层配置 |

### 3.1 详细提供商列表

**lop_minimal**: OpenAI, Anthropic, OpenRouter, MiniMax, Google (Gemini), Kimi, GLM (智谱)

**codex**: OpenAI (GPT-4o, etc.)

**qwen-code**:
- OpenAI 兼容 (Bailian, ModelScope, OpenRouter)
- Anthropic (Claude)
- Google GenAI (Gemini)
- Qwen OAuth (1000 次/天免费)

**opencode**:
- OpenAI, Anthropic, Google, Azure
- xAI, Groq, Mistral, Cohere, Cerebras
- DeepInfra, TogetherAI, Perplexity
- Amazon Bedrock, GitLab, GitHub Copilot
- 以及通过 OpenRouter 接入的更多模型

---

## 4. 工具集对比

### 4.1 基础工具

所有项目都支持的基础工具：
- 文件读写 (read/write)
- 文件编辑 (edit)
- 目录列表 (ls/listDirectory)
- 内容搜索 (grep)
- 文件匹配 (glob)
- 命令执行 (bash/shell)

### 4.2 高级工具对比

| 工具 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **ripgrep 搜索** | ✅ (grep 工具) | ❌ | ✅ | ❌ |
| **网页抓取 (webfetch)** | ❌ | ❌ | ❌ | ✅ |
| **网络搜索 (websearch)** | ❌ | ✅ | ✅ | ✅ |
| **代码搜索 (codesearch)** | ❌ | ❌ | ❌ | ✅ |
| **LSP 语言服务器** | ❌ | ❌ | ✅ | ✅ |
| **子代理 (subagent)** | ✅ | ✅ | ✅ | ✅ |
| **待办事项 (todo)** | ❌ | ❌ | ✅ | ✅ |
| **技能系统 (skill)** | ✅ | ✅ | ✅ | ✅ |
| **MCP 工具** | ✅ | 完整 | 完整 | 完整 |
| **结构化补丁 (apply_patch)** | ❌ | ✅ | ❌ | ✅ |
| **批量编辑 (multiedit)** | ❌ | ❌ | ❌ | ✅ |
| **询问用户 (askUser)** | ✅ | ❌ | ✅ | ✅ |

---

## 5. Slash 命令对比

### 5.1 lop_minimal

| 命令 | 别名 | 功能 |
|------|------|------|
| /help | | 显示帮助 |
| /clear | | 清空对话 |
| /quit | | 退出 |
| /stats | | 显示统计 |
| /btw | | 边问 (side question) |
| /theme | themes, appearance | 切换 UI 主题 |
| /mcp | | MCP 管理 (list/reload) |
| /sessions | list | 列出保存的会话 |
| /load | resume | 加载历史会话 (无参数则加载最新) |
| /delete | rm | 删除保存的会话 |
| /rename | title | 设置会话标题 |
| /skills | | 列出已加载技能 |
| /skill | | 调用技能 / 包管理 (install/uninstall/update) |
| /approval-mode | am | 设置审批模式 (default/cautious/yolo) |
| /instructions | | 显示已加载的指令文件 |
| /compress | | 手动触发上下文压缩 |
| /context | | 显示上下文窗口用量 |

### 5.2 codex

无内置 slash 命令，纯 AI 驱动。

### 5.3 qwen-code

| 命令 | 功能 |
|------|------|
| /help | 帮助 |
| /clear | 清空对话 |
| /compress | 压缩上下文 |
| /stats | 会话统计 |
| /bug | 提交 bug |
| /auth | 认证切换 |
| /model | 切换模型 |
| /arena | 模型对比模式 |
| /mcp | MCP 管理 |
| /extensions | 扩展管理 |
| /agents | 代理管理 |

### 5.4 opencode

通过 Tab 键切换 Agent 模式，无传统 slash 命令。

---

## 6. 安全与权限系统

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **OS 级沙箱** | ❌ | ✅ Seatbelt/Landlock | ❌ | ❌ |
| **权限 Hook** | ✅ beforeToolExecute | Policy hooks | ✅ | ✅ |
| **自动批准模式** | ✅ yolo/cautious/default | --full-auto | --yolo | Agent 策略 |
| **Docker 沙箱** | ❌ | ❌ | ✅ 可选 | ❌ |

### 6.1 codex 沙箱策略

```bash
codex --sandbox read-only      # 只读模式
codex --sandbox workspace-write # 工作区写入
codex --sandbox danger-full-access # 完全访问
```

### 6.2 opencode 权限引擎

支持三种权限响应：allow、deny、ask

不同 Agent 有不同默认策略：
- `build`: 允许所有操作
- `plan`: 禁止编辑，询问命令

---

## 7. 上下文管理

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **Token 跟踪** | ✅ | ✅ | ✅ | ✅ |
| **上下文压缩** | ✅ 自动 + 手动 | ✅ | /compress 命令 | **自动 compaction** |
| **会话持久化** | JSONL + 索引 | Rollout files | SQLite | SQLite |
| **会话恢复** | ✅ /load + --resume | ✅ | ✅ | ✅ |
| **Doom Loop 检测** | ❌ (接口已定义) | ❌ | ❌ | ✅ |
| **最大步数限制** | ✅ 10步 | ❌ | ❌ | ✅ |

### 7.1 opencode 的 Compaction 机制

当 Token 超过阈值时，自动启动 compaction agent：
1. 总结对话历史为结构化格式
2. 截断旧消息
3. 保留关键信息

---

## 8. MCP (Model Context Protocol) 支持

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **MCP Client** | ✅ (stdio/HTTP/SSE) | 完整 | 完整 | 完整 |
| **MCP Server** | ❌ | ✅ (experimental) | ❌ | ❌ |
| **远程 MCP** | ❌ | ❌ | ❌ | ✅ |
| **OAuth 支持** | ❌ | ❌ | ✅ | ✅ |

### 8.1 MCP 工具集成

**qwen-code**: `mcp-tool.ts` 将 MCP 工具转换为内部工具

**opencode**: 将 MCP 工具转为 Vercel AI SDK 的 `dynamicTool`

---

## 9. 扩展系统

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **扩展系统** | ❌ | ❌ | ✅ Extensions | ✅ Plugins |
| **Skills 系统** | ✅ | ✅ | ✅ | ✅ |
| **Hook 系统** | ✅ | ✅ | ✅ | ✅ |

### 9.1 qwen-code Extensions

- VS Code 风格的扩展系统
- 支持从 GitHub 安装扩展
- 扩展可注册工具、命令、hooks

### 9.2 opencode Plugins

- npm 包或本地文件
- 内置插件：CodexAuth, CopilotAuth, GitlabAuth
- Hook 类型：chat.system.transform, chat.params, tool.definition 等

---

## 10. 多平台支持

| 特性 | lop_minimal | codex | qwen-code | opencode |
|------|-------------|-------|-----------|----------|
| **Terminal UI** | ✅ Ink | ✅ Ratatui | ✅ Ink | ✅ OpenTUI |
| **Desktop App** | ❌ | ❌ | ❌ | ✅ Tauri |
| **Web UI** | ❌ | ❌ | ✅ | ✅ |
| **IDE 插件** | ❌ | ❌ | ✅ VSCode/Zed/JetBrains | ❌ |
| **远程驱动** | ❌ | ❌ | ❌ | ✅ |
| **Headless** | ❌ | ✅ | ✅ | ✅ |

---

## 11. 独特亮点功能

### 11.1 lop_minimal

- 极简架构，代码量少，易于理解和定制
- JSON-RPC over stdio 通信
- 轻量级，启动快
- 自动上下文压缩（75% 阈值触发）
- JSONL 会话持久化 + 自动清理（30天/50条上限）
- 完整的 Skills 系统（发现/加载/包管理/热重载）
- 子代理委托（内置 explore/general-purpose，支持自定义 .md 配置）
- 三级审批模式（default/cautious/yolo）+ 内置安全策略
- MCP 全协议支持（stdio/HTTP/SSE 三种传输）

### 11.2 codex

- **OS 级沙箱安全**: Seatbelt (macOS), Landlock (Linux), Windows Sandbox
- **`codex exec`**: Headless 执行模式
- **Notifications**: 桌面通知支持
- **Realtime 模式**: 支持语音对话

### 11.3 qwen-code

- **Arena 模式**: 多模型对比
- **Extensions 市场**: VS Code 风格的扩展生态
- **Subagents**: YAML 配置的子代理系统
- **LSP 集成**: 完整的语言服务器支持
- **多语言文档**: 中文、日文、德文、法文等

### 11.4 opencode

- **20+ LLM 提供商**: 最广泛的模型支持
- **自动 Compaction**: 智能上下文压缩
- **Doom Loop 检测**: 3 次相同调用自动触发权限确认
- **Git 快照**: 每步自动快照，支持回滚
- **Skills 发现**: 自动扫描 .opencode/skills/
- **Web/Desktop 客户端**: 完整的跨平台支持

---

## 12. 核心差距总结

### 12.1 lop_minimal 缺失的关键功能

1. **安全沙箱**: 无 OS 级沙箱机制（仅有应用层权限策略）
2. **工具丰富度**: 缺少 webfetch、websearch、codesearch、LSP
3. **Doom Loop 防护**: 接口已定义但未实现，仅靠 maxTurns 兜底
4. **扩展生态**: 无 Extensions/Plugins 市场（Skills 系统可部分替代）
5. **多平台**: 无 Desktop/Web/IDE 支持
6. **远程 MCP**: 不支持远程 MCP Server 连接
7. **OAuth 集成**: 无 OAuth 认证流程

### 12.2 各项目优势

| 项目 | 核心优势 |
|------|---------|
| **lop_minimal** | 极简、易理解、可定制、已具备核心功能闭环 |
| **codex** | 安全沙箱、官方支持 |
| **qwen-code** | 扩展生态、多语言、Arena |
| **opencode** | 功能最全面、Provider 最多 |

---

## 13. 发展建议

基于对比分析，lop_minimal 可考虑以下发展方向：

### 短期 (1-2 个月)
1. 实现 Doom Loop 检测（接口已定义，需接入 agent loop）
2. 添加 webfetch / websearch 工具
3. 完善 MCP Client（添加远程 MCP 支持）

### 中期 (3-6 个月)
1. 实现 LSP 工具集成
2. 添加待办事项 (todo) 工具
3. 考虑轻量级沙箱机制

### 长期 (6-12 个月)
1. 扩展 LLM Provider 支持（OAuth 集成）
2. Web UI 或 Desktop App 原型
3. IDE 插件支持

---

*报告结束*

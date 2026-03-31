# Claude Code 系统提示词（中文翻译）

此目录包含 Claude Code 官方系统提示词的中文翻译版本，供 lop_minimal 项目参考学习。

**来源**: [claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

---

## 文件列表

### Agent 提示词（子代理）

| 文件 | 描述 |
|------|------|
| `agent-prompt-explore.md` | Explore 子代理 - 用于快速探索代码库 |
| `agent-prompt-general-purpose.md` | 通用子代理 - 用于复杂研究和多步骤任务 |
| `agent-prompt-claudemd-creation.md` | CLAUDE.md 创建代理 - 分析代码库生成项目文档 |
| `agent-prompt-plan-mode-enhanced.md` | Plan 模式代理 - 软件架构师，设计实现计划 |
| `agent-prompt-session-memory-update-instructions.md` | 会话记忆更新指令 |

### 系统提示词（核心行为）

| 文件 | 描述 |
|------|------|
| `system-prompt-output-efficiency.md` | 输出效率 - 简洁直接，先给答案 |
| `system-prompt-learning-mode.md` | 学习模式 - 协作式教学，请求人工贡献 |
| `system-prompt-executing-actions-with-care.md` | 谨慎执行 - 考虑可逆性和影响范围 |
| `system-prompt-subagent-delegation-examples.md` | 子代理委派示例 |
| `system-prompt-context-compaction-summary.md` | 上下文压缩摘要 - 用于 `/compact` 命令生成任务延续摘要 |

### 任务执行原则

| 文件 | 描述 |
|------|------|
| `system-prompt-doing-tasks-read-before-modifying.md` | 修改前先阅读代码 |
| `system-prompt-doing-tasks-minimize-file-creation.md` | 优先编辑而非创建新文件 |
| `system-prompt-doing-tasks-no-unnecessary-additions.md` | 不要添加不必要的功能 |
| `system-prompt-doing-tasks-security.md` | 避免引入安全漏洞 |

### 工具使用指南

| 文件 | 描述 |
|------|------|
| `system-prompt-tool-usage-read-files.md` | 使用 Read 工具而非 cat/head/tail |
| `system-prompt-tool-usage-edit-files.md` | 使用 Edit 工具而非 sed/awk |
| `system-prompt-tool-usage-create-files.md` | 使用 Write 工具而非重定向 |
| `system-prompt-tool-usage-search-files.md` | 使用 Glob 工具而非 find/ls |
| `system-prompt-tool-usage-search-content.md` | 使用 Grep 工具而非 grep/rg |
| `system-prompt-tool-usage-reserve-bash.md` | 将 Bash 保留给系统命令 |

### Skills

| 文件 | 描述 |
|------|------|
| `skill-simplify.md` | Simplify Skill - 代码审查和清理 |

---

## 关键原则总结

### 1. 输出效率
- 直奔主题，尝试最简单的方法
- 先给出答案或行动，而非推理过程
- 跳过填充词和不必要的过渡

### 2. 工具使用优先顺序
```
Read > cat/head/tail
Edit > sed/awk
Write > echo/cat heredoc
Glob > find/ls
Grep > grep/rg
```

### 3. 代码修改原则
- 修改前先阅读代码
- 优先编辑现有文件，而非创建新文件
- 不要添加超出要求的功能
- 避免引入安全漏洞

### 4. 子代理使用
- Explore: 快速搜索代码库（只读）
- General Purpose: 复杂研究任务
- Plan: 软件架构设计

### 5. 谨慎执行
- 本地可逆操作可以自由执行
- 破坏性操作需要用户确认
- 难以逆转的操作需要先确认

---

*最后更新: 2026-03-31*

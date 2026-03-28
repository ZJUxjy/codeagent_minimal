# lop — 极简 AI 编程助手

轻量、终端原生的 AI 编程助手。本地运行，支持主流 LLM 提供商，完整保存每次对话历史。

```
┌─────────────────────────────────────────────────────────┐
│  lop  ·  anthropic/claude-sonnet-4-5  ·  会话:a3f2      │
├─────────────────────────────────────────────────────────┤
│  > 把 auth 模块重构成 async/await 风格                    │
│                                                         │
│  好的，先看一下当前实现。                                 │
│  ● read  src/auth/index.ts                              │
│  ● edit  src/auth/index.ts                              │
│  完成。将 3 处回调链改为 async/await，并添加了正确的       │
│  错误传递。                                              │
│                                                         │
│ ╭──────────────────────────────────────╮                │
│ │ > 输入消息或 /help 查看命令...         │  [+]           │
│ ╰──────────────────────────────────────╯                │
└─────────────────────────────────────────────────────────┘
```

## 功能特性

**核心能力**
- 实时流式响应，支持思考过程（Thinking）展示
- 多 LLM 提供商 — Anthropic、OpenAI、Google，或任意兼容 OpenAI 协议的接口
- 完整工具调用：读写文件、执行 bash 命令、代码搜索、文件 glob
- MCP（模型上下文协议）支持 — 接入任意 MCP 兼容工具服务器

**会话管理**
- 对话跨重启持久化，随时恢复
- `/sessions` 列出所有历史会话，含时间、消息数、内容预览
- `/load`、`/rename`、`/delete` 完整管理会话生命周期
- `--resume` 参数启动时自动加载最近一次会话

**终端界面**
- 基于 React + Ink 构建，自适应终端窗口尺寸
- 三套主题：`dark`、`light`、`ansi`
- 大段粘贴优化——粘贴大量文本时显示紧凑占位符，提交时原始内容完整发送给 LLM
- Emacs 风格快捷键（Ctrl+A/E/K/U/W，Meta+F/B）
- 斜杠命令自动补全

## 快速开始

```bash
# 安装依赖
npm install

# 设置 API Key
export LOP_API_KEY=sk-ant-...          # Anthropic（默认）
# export LOP_API_KEY=sk-...            # OpenAI
# export LOP_API_KEY=...               # Google

# 开发模式运行
npm run dev

# 或构建后运行
npm run build && npm start
```

## 命令行参数

```
lop [选项]

  -p, --provider <name>     LLM 提供商：anthropic | openai | google
  -m, --model <name>        模型名称（如 claude-sonnet-4-5）
  -d, --directory <path>    Agent 工作目录（默认：当前目录）
      --theme <name>        界面主题：dark | light | ansi
  -r, --resume              自动恢复最近一次会话
```

## 配置文件

lop 从当前目录向上查找配置文件，最终检查 `$HOME`。支持的文件名：`config.json`、`lop.config.json`、`.lop.config.json`。

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

**环境变量**（优先级高于配置文件）：

| 变量 | 说明 |
|---|---|
| `LOP_PROVIDER` | `anthropic` \| `openai` \| `google` |
| `LOP_MODEL` | 模型名称 |
| `LOP_API_KEY` | API 密钥 |
| `LOP_BASE_URL` | 自定义 API 地址 |
| `LOP_THEME` | `dark` \| `light` \| `ansi` |
| `LOP_DEBUG` | 开启调试日志（`true` / `1`）|

## 内置命令

| 命令 | 别名 | 说明 |
|---|---|---|
| `/help` | | 列出所有可用命令 |
| `/clear` | | 清空当前对话 |
| `/quit` | `/exit` | 退出程序 |
| `/sessions` | `/list` | 列出保存的会话 |
| `/load [id]` | | 按 ID 前缀恢复会话 |
| `/rename <id> <标题>` | `/title` | 为会话命名 |
| `/delete <id>` | | 删除会话 |
| `/stats` | | 查看工具调用统计 |
| `/theme [名称]` | | 切换界面主题 |
| `/mcp list` | | 列出已连接的 MCP 服务器和工具 |
| `/mcp reload` | | 重新加载 MCP 连接 |

## Agent 工具

对话过程中 Agent 可使用以下工具：

| 工具 | 说明 |
|---|---|
| `bash` | 在工作目录执行 shell 命令 |
| `read` | 读取文件内容 |
| `write` | 写入或覆盖文件 |
| `edit` | 替换文件中的特定字符串 |
| `glob` | 按 glob 模式查找文件 |
| `grep` | 用正则表达式搜索文件内容 |
| `listDirectory` | 列出目录内容 |
| `askQuestion` | 向用户请求澄清 |
| MCP 工具 | 从已配置的 MCP 服务器动态加载 |

## 架构

lop 采用 **stdin/stdout 上的客户端-服务端分离架构**：

```
终端界面（React + Ink）
       |
   JSON-RPC 2.0
       |
  Agent 服务端（子进程）
  ├── LLM 客户端（ai SDK）
  ├── 工具注册表
  ├── 会话存储（JSONL 文件）
  └── MCP 客户端管理器
```

TUI 将 Agent 服务端作为子进程启动，通过 JSON-RPC 通信。UI 逻辑与 Agent 逻辑完全隔离——服务端可单独运行以便调试，客户端可独立替换。

会话以 JSONL 文件存储在 `~/.lop/sessions/<目录哈希>/` 下，并维护一份 `index.json` 元数据缓存，实现 O(1) 会话列表查询。

## 开发

```bash
npm run dev      # 用 tsx 直接运行（无需构建）
npm run build    # 编译 TypeScript → dist/
npm run test     # 用 vitest 运行测试
npm run server   # 单独运行 Agent 服务端（调试用）
```

## 环境要求

- Node.js ≥ 20.0.0
- 支持 bracketed paste mode 的终端（主流现代终端均支持）
- 至少一个受支持的 LLM 提供商的 API Key

# 文件搜索工具设计方案

## 概述

为 lop_minimal 项目添加三个文件搜索工具：glob、grep、list_directory，支持递归搜索和忽略模式。

## 工具清单

### 1. glob - 文件模式匹配

**功能**: 使用 glob 模式快速查找文件

**参数**:
```typescript
{
  pattern: string      // glob 模式，如 "**/*.ts", "src/**/*.tsx"
  path?: string        // 搜索路径，默认当前目录
  ignore?: string[]    // 忽略模式，如 ["node_modules", "*.test.ts"]
}
```

**返回**: 匹配的文件路径列表，按修改时间排序

**实现**: 使用 `fast-glob` 库（高性能，支持高级 glob 特性）

---

### 2. grep - 内容正则搜索

**功能**: 在文件内容中搜索正则表达式

**参数**:
```typescript
{
  pattern: string      // 正则表达式模式
  path?: string        // 搜索路径/文件，默认当前目录
  glob?: string        // 文件过滤，如 "*.ts"
  ignoreCase?: boolean // 忽略大小写，默认 false
  context?: number     // 显示匹配行上下文行数
}
```

**返回**: 匹配结果，包含文件名、行号、匹配内容

**实现**: 使用 `exec` 调用系统 `grep` 命令（兼容性好），备选纯 JS 实现

---

### 3. list_directory - 目录列表

**功能**: 列出目录内容

**参数**:
```typescript
{
  path?: string        // 目录路径，默认当前目录
  recursive?: boolean  // 递归列出子目录，默认 false
  ignore?: string[]    // 忽略模式
}
```

**返回**: 目录内容列表，区分文件和目录

**实现**: 使用 `fs.readdir` + `fs.stat`

---

## 技术设计

### 文件结构

```
src/server/tools/
├── types.ts           # 现有 - Tool 接口
├── index.ts           # 修改 - 注册新工具
├── bash.ts            # 现有
├── read.ts            # 现有
├── write.ts           # 现有
├── edit.ts            # 现有
├── glob.ts            # 新增
├── grep.ts            # 新增
└── listDirectory.ts   # 新增
```

### 依赖

```json
{
  "fast-glob": "^3.3.0"  // glob 工具使用
}
```

### 错误处理

- 路径不存在: 返回明确错误信息
- 权限不足: 返回权限错误
- 超时: 设置合理超时，防止大目录扫描阻塞

---

## 实现优先级

1. **glob** - 基础文件查找，优先实现
2. **grep** - 内容搜索，依赖 glob 的忽略模式逻辑
3. **list_directory** - 目录浏览，相对简单

## 验收标准

- [ ] glob 工具支持常见 glob 模式
- [ ] grep 工具支持正则搜索和上下文显示
- [ ] list_directory 支持递归和忽略模式
- [ ] 所有工具有合理的错误处理
- [ ] 工具注册到 ToolRegistry 并可被 LLM 调用

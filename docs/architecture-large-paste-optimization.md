# 大段内容粘贴优化方案

本文档介绍 Qwen Code CLI 如何处理用户在终端中粘贴大段内容的场景，涵盖从底层终端事件识别到上层 UI 交互优化的完整链路。

## 背景与问题

在终端 CLI 应用中，用户可能会将大段代码、日志或文本粘贴到输入框中。如果不做任何特殊处理，会遇到以下问题：

1. **渲染性能差**：成百上千行文本直接插入输入 buffer，每次按键都会触发重新渲染，导致终端严重卡顿。
2. **误触发提交**：粘贴内容中可能包含换行符 `\r`，某些终端会将其作为 Enter 键处理，导致内容粘贴到一半就被提交。
3. **输入框不可用**：大段文本充满整个屏幕，用户无法看到已有内容、无法正常继续编辑。
4. **字符逐个处理开销大**：没有 Bracketed Paste 支持的终端会将粘贴内容拆成单字符逐个发送，效率极低。

## 整体架构

```
粘贴内容到达终端
       │
       ▼
┌──────────────────────────────┐
│  Layer 1: Bracketed Paste    │  终端级粘贴事件识别
│  useBracketedPaste.ts        │  整包接收，不逐字符处理
│  KeypressContext.tsx          │
└──────────────┬───────────────┘
               │ paste=true 事件
               ▼
┌──────────────────────────────┐
│  Layer 2: InputPrompt        │  核心分流逻辑
│  InputPrompt.tsx             │
│  ┌────────┬────────┬───────┐ │
│  │ 图片   │ 大内容 │ 小内容│ │
│  │ 附件   │ 占位符 │ 直接  │ │
│  │ 处理   │ 替换   │ 插入  │ │
│  └────────┴────────┴───────┘ │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Layer 3: text-buffer        │  路径识别 & buffer 写入
│  text-buffer.ts              │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│  Layer 4: 提交时展开         │  占位符还原 + 发送
│  handleSubmitAndClear()      │
└──────────────────────────────┘
```

## Layer 1: 终端级粘贴事件识别

### 1.1 Bracketed Paste Mode

**文件**：`packages/cli/src/ui/hooks/useBracketedPaste.ts`

Qwen Code 在启动时向终端发送 VT100 转义序列开启 [Bracketed Paste Mode](https://cirw.in/blog/bracketed-paste)：

```typescript
const ENABLE_BRACKETED_PASTE = '\x1b[?2004h';
const DISABLE_BRACKETED_PASTE = '\x1b[?2004l';
```

开启后，终端在用户粘贴时会自动用 `ESC[200~` 和 `ESC[201~` 将粘贴内容包裹。这使得应用能够：

- **区分键入和粘贴**：逐字输入不会带有边界标记，粘贴内容有明确的起止标记。
- **整包接收**：粘贴内容作为一个完整单元处理，而不是逐字符触发事件。

组件卸载或进程退出时自动恢复终端状态，防止影响后续命令行使用。

### 1.2 KeypressContext 中的粘贴识别

**文件**：`packages/cli/src/ui/contexts/KeypressContext.tsx`

`KeypressProvider` 负责将原始终端输入解析为结构化的 `Key` 事件。粘贴识别有两条路径：

#### 路径 A：标准 Bracketed Paste（大多数现代终端）

```typescript
const handleKeypress = async (_: unknown, key: Key) => {
  if (key.name === 'paste-start') {
    isPaste = true;
    return;
  }
  if (key.name === 'paste-end') {
    isPaste = false;
    // 将整个 pasteBuffer 作为一次事件广播
    broadcast({
      name: '',
      ctrl: false, meta: false, shift: false,
      paste: true,
      sequence: pasteBuffer.toString(),
    });
    pasteBuffer = Buffer.alloc(0);
    return;
  }
  if (isPaste) {
    // 粘贴过程中，所有内容追加到 buffer，不逐个广播
    pasteBuffer = Buffer.concat([pasteBuffer, Buffer.from(key.sequence)]);
    return;
  }
};
```

收到 `paste-start` 后进入累积模式，所有后续字符写入 `pasteBuffer`；收到 `paste-end` 后将整个 buffer 以**单次** `{ paste: true }` 事件广播。

#### 路径 B：Paste Workaround（Windows 或老旧终端）

对于不支持 Bracketed Paste 的终端（如部分 Windows 终端），启用 `pasteWorkaround` 模式：

```typescript
const flushRawBuffer = () => {
  // 如果 rawDataBuffer 包含多个 \r（回车），
  // 说明可能是粘贴内容而非手动输入
  if (
    (rawDataBuffer.length <= 2 && rawDataBuffer.includes(0x0d)) ||
    !rawDataBuffer.includes(0x0d) ||
    isPaste
  ) {
    keypressStream.write(rawDataBuffer);
  } else {
    // 将含多个回车的大数据块视为粘贴
    handleKeypress(undefined, createPasteKeyEvent('paste-start'));
    keypressStream.write(rawDataBuffer);
    handleKeypress(undefined, createPasteKeyEvent('paste-end'));
  }
};
```

通过 raw data 的特征（多字节同时到达且含多个回车符）推断粘贴行为，并合成 paste 事件。

### 1.3 拖拽文件识别

**文件**：`packages/cli/src/ui/contexts/KeypressContext.tsx`

从 IDE 或文件管理器拖拽文件到终端也会产生类似粘贴的行为（路径字符快速连续到达）。`KeypressProvider` 用 100ms 的防抖定时器收集拖拽数据：

```typescript
export const DRAG_COMPLETION_TIMEOUT_MS = 100;

// 以引号开头的输入进入拖拽缓冲模式
if (key.sequence === SINGLE_QUOTE || key.sequence === DOUBLE_QUOTE || isDraggingRef.current) {
  isDraggingRef.current = true;
  dragBufferRef.current += key.sequence;
  draggingTimerRef.current = setTimeout(() => {
    isDraggingRef.current = false;
    broadcast({ ...key, name: '', paste: true, sequence: dragBufferRef.current });
  }, DRAG_COMPLETION_TIMEOUT_MS);
  return;
}
```

## Layer 2: 大内容占位符机制

**文件**：`packages/cli/src/ui/components/InputPrompt.tsx`

这是整个优化方案的核心。当 `InputPrompt` 收到 `paste: true` 事件后，根据内容大小走不同路径。

### 2.1 判定阈值

```typescript
const LARGE_PASTE_CHAR_THRESHOLD = 1000;  // 超过 1000 个 Unicode 字符
const LARGE_PASTE_LINE_THRESHOLD = 10;    // 超过 10 行
```

任一条件满足即视为「大段粘贴」。

### 2.2 分流处理

```typescript
if (key.paste) {
  setRecentPasteTime(Date.now());  // 记录粘贴时间（防误触用）

  const pasted = key.sequence.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const charCount = [...pasted].length;  // 正确处理 Unicode
  const lineCount = pasted.split('\n').length;

  if (key.pasteImage) {
    // 路径 A：剪贴板图片 → 保存为附件
    handleClipboardImage(true);
  } else if (charCount > LARGE_PASTE_CHAR_THRESHOLD || lineCount > LARGE_PASTE_LINE_THRESHOLD) {
    // 路径 B：大内容 → 占位符替换
    const placeholder = nextLargePastePlaceholder(charCount);
    setPendingPastes(prev => { ... });
    buffer.insert(placeholder, { paste: false });
  } else {
    // 路径 C：小内容 → 直接插入 buffer
    buffer.handleInput(key);
  }
}
```

### 2.3 占位符生成

```typescript
const nextLargePastePlaceholder = useCallback((charCount: number): string => {
  const activeIds = activePlaceholderIds.current.get(charCount) || new Set();
  let id = 1;
  while (activeIds.has(id)) { id++; }
  activeIds.add(id);
  activePlaceholderIds.current.set(charCount, activeIds);
  const base = `[Pasted Content ${charCount} chars]`;
  return id === 1 ? base : `${base} #${id}`;
}, []);
```

- 第一次粘贴 5000 字符的内容显示为：`[Pasted Content 5000 chars]`
- 第二次粘贴同样长度的内容显示为：`[Pasted Content 5000 chars] #2`
- 真实内容存储在 `pendingPastes: Map<string, string>` 中（key 为占位符文本，value 为原始粘贴内容）

这样，用户在输入框中只看到一行简短的占位符，而不是数千行的原始文本。

### 2.4 占位符删除

当用户按退格键删除占位符时，不是逐字符删除，而是整块移除：

```typescript
if (pendingPastes.size > 0 && (key.name === 'backspace' || ...)) {
  // 计算光标所在的偏移量
  let offset = 0;
  for (let i = 0; i < row; i++) {
    offset += buffer.lines[i].length + 1;
  }
  offset += col;

  // 检查光标是否在某个占位符的末尾
  for (const placeholder of pendingPastes.keys()) {
    const placeholderStart = offset - placeholder.length;
    if (placeholderStart >= 0 && text.slice(placeholderStart, offset) === placeholder) {
      buffer.replaceRangeByOffset(placeholderStart, offset, '');
      setPendingPastes(prev => { next.delete(placeholder); return next; });
      freePlaceholderId(parsed.charCount, parsed.id);
      return true;
    }
  }
}
```

当光标位于占位符末尾时，一次退格操作会删除整个占位符文本，并从 `pendingPastes` 中移除对应条目，释放 ID 供后续复用。

### 2.5 提交时展开

```typescript
const handleSubmitAndClear = useCallback((submittedValue: string) => {
  let finalValue = submittedValue;
  if (pendingPastes.size > 0) {
    // 按长度降序排列，避免短占位符错误匹配长占位符的子串
    const placeholders = Array.from(pendingPastes.keys()).sort((a, b) => b.length - a.length);
    const escaped = placeholders.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regex = new RegExp(escaped.join('|'), 'g');
    finalValue = finalValue.replace(regex, match => pendingPastes.get(match) ?? match);
    setPendingPastes(new Map());
    activePlaceholderIds.current.clear();
  }
  // 继续提交 finalValue...
}, [pendingPastes]);
```

提交时将输入文本中的所有占位符**正则替换**为真实的粘贴内容，然后发送给模型。用户无感知，模型收到完整的原始内容。

## Layer 3: text-buffer 路径自动识别

**文件**：`packages/cli/src/ui/components/shared/text-buffer.ts`

对于没有被占位符截获的粘贴内容（小于阈值），`text-buffer` 的 `insert` 函数还有一层路径识别优化：

```typescript
const insert = useCallback(
  (ch: string, { paste = false }: { paste?: boolean } = {}): void => {
    const minLengthToInferAsDragDrop = 3;
    if (ch.length >= minLengthToInferAsDragDrop && !shellModeActive && paste) {
      let potentialPath = ch.trim();
      const quoteMatch = potentialPath.match(/^'(.*)'$/);
      if (quoteMatch) {
        potentialPath = quoteMatch[1];
      }
      potentialPath = potentialPath.trim();
      if (isValidPath(unescapePath(potentialPath))) {
        ch = `@${potentialPath} `;  // 自动转为 @文件引用 语法
      }
    }
    // ...继续插入
  },
  [isValidPath, shellModeActive],
);
```

当粘贴内容是一个合法的文件路径时，自动在前面加 `@` 前缀，转换为 Qwen Code 的文件引用语法（`@/path/to/file`），使模型能够读取该文件的内容。该逻辑仅在非 Shell 模式下生效，在 Shell 模式中路径作为普通文本处理。

## Layer 4: 防误触提交保护

**文件**：`packages/cli/src/ui/components/InputPrompt.tsx`

在不支持 Bracketed Paste 的终端中，粘贴内容中的 `\r` 可能被终端解释为 Enter 键事件。为此设计了一个 500ms 的安全窗口：

```typescript
if (key.paste) {
  // 记录粘贴时间
  setRecentPasteTime(Date.now());
  pasteTimeoutRef.current = setTimeout(() => {
    setRecentPasteTime(null);
  }, 500);
}

// 在提交逻辑中检查
if (keyMatchers[Command.SUBMIT](key)) {
  if (pasteWorkaround && recentPasteTime !== null) {
    // 粘贴后 500ms 内的 Enter 被拦截，不触发提交
    return true;
  }
  // ...正常提交
}
```

该保护仅在 `pasteWorkaround` 模式下启用（Windows 或 Node < 20 环境），避免在正常环境下干扰用户体验。

## 关键设计决策

| 决策 | 选择 | 原因 |
|------|------|------|
| 大内容阈值 | 1000 字符 / 10 行 | 在「显示完整内容」和「保持输入框可用性」之间取平衡 |
| 占位符格式 | `[Pasted Content N chars]` | 用户能直观看到粘贴内容的大小，且可区分多次粘贴 |
| 展开时机 | 提交时 | 延迟展开，避免在编辑阶段引入大段文本的渲染开销 |
| 整块删除 | 退格键感知 | 占位符作为一个原子单元，避免删到一半产生不完整的占位符 |
| ID 复用 | 最小可用 ID | 多次粘贴/删除后占位符编号不会无限增长 |
| 路径识别 | paste + 非 Shell | 仅在常规模式下自动转 `@` 引用，Shell 模式保持原始路径 |

## 涉及的源码文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/ui/hooks/useBracketedPaste.ts` | 启用/禁用终端 Bracketed Paste Mode |
| `packages/cli/src/ui/contexts/KeypressContext.tsx` | 原始输入解析、粘贴事件识别、拖拽防抖 |
| `packages/cli/src/ui/components/InputPrompt.tsx` | 大内容占位符逻辑、防误触保护、提交时展开 |
| `packages/cli/src/ui/components/shared/text-buffer.ts` | 路径自动识别、Unicode 字符处理、buffer 操作 |

# qwen-code CLI 文本输入框架构设计解析

## 概述

qwen-code 的 CLI 文本输入框是一个**分层架构**的工业级实现，采用 React + Ink 技术栈，在终端环境中构建了一个功能完整的文本编辑器。本文档详细解析其五层架构设计：键盘监听层、状态层、渲染层、增强层和数据流。

---

## 一、键盘监听层 (Keypress Layer)

### 1.1 架构位置

```
┌─────────────────────────────────────────────────────────────┐
│                    键盘监听层                                │
│  KeypressContext.tsx ─────────────────────────────────────  │
│  ├─ stdin 原始输入捕获                                       │
│  ├─ Kitty Protocol 解析                                      │
│  ├─ Bracketed Paste 处理                                     │
│  └─ 发布-订阅模式分发                                        │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 核心组件

**KeypressContext** (`packages/cli/src/ui/contexts/KeypressContext.tsx`)

```typescript
interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
  pasteWorkaround: boolean;
}

interface Key {
  name: string;        // 键名 (e.g., 'return', 'backspace', 'up')
  ctrl: boolean;       // Ctrl 修饰键
  meta: boolean;       // Alt/Option 修饰键
  shift: boolean;      // Shift 修饰键
  paste: boolean;      // 是否来自粘贴操作
  sequence: string;    // 原始字符序列
  kittyProtocol?: boolean;
  pasteImage?: boolean;
}
```

### 1.3 输入处理流程

```
stdin 'data' 事件
    ↓
┌──────────────────────────────────────────────────────────────┐
│  handleRawKeypress()                                         │
│  ├─ Buffer 累积原始数据                                       │
│  ├─ 检测 Bracketed Paste 标记 (ESC[200~ / ESC[201~)         │
│  └─ 转换为 keypress 事件                                      │
└──────────────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────────────────────────────┐
│  handleKeypress()                                            │
│  ├─ Paste 模式处理                                           │
│  ├─ Kitty Protocol 解析 (CSI-u sequences)                    │
│  ├─ 拖放检测 (引号包围的路径)                                 │
│  ├─ \\ + Enter 换行处理                                      │
│  └─ 构建标准化 Key 对象                                       │
└──────────────────────────────────────────────────────────────┘
    ↓
broadcast(key) → 所有订阅者
```

### 1.4 Kitty Protocol 支持

qwen-code 支持 Kitty 键盘协议，处理复杂的键盘事件：

```typescript
// CSI-u 格式解析
const csiUPrefix = new RegExp(`^${ESC}\[(\d+)(;(\d+))?([u~])`);

// 解析示例:
// ESC [ 97 ; 5 u  → Ctrl+A (keyCode=97, mods=5)
// ESC [ 1 ; 3 A   → Alt+Up (symbol=A, mods=3)
```

**支持的序列类型：**

| 类型 | 格式 | 说明 |
|------|------|------|
| 反向 Tab | `ESC [ Z` 或 `ESC [ 1 ; <mods> Z` | Shift+Tab |
| 方向键 | `ESC [ 1 ; <mods> (A\|B\|C\|D)` | 带修饰键的箭头 |
| 功能键 | `ESC [ <code> ; <mods> ~` | Delete/Insert/Home/End |
| CSI-u | `ESC [ <code> ; <mods> u` | 通用键码格式 |
| 传统方向键 | `ESC [ (A\|B\|C\|D\|H\|F)` | 无修饰键 |

### 1.5 订阅-发布模式

```typescript
// 订阅者管理
const subscribers = useRef<Set<KeypressHandler>>(new Set());

const subscribe = useCallback((handler: KeypressHandler) => {
  subscribers.add(handler);
}, []);

const unsubscribe = useCallback((handler: KeypressHandler) => {
  subscribers.delete(handler);
}, []);

// 广播事件
const broadcast = (key: Key) => {
  for (const handler of subscribers) {
    handler(key);
  }
};
```

### 1.6 useKeypress Hook

提供给组件的简洁接口：

```typescript
export function useKeypress(
  onKeypress: KeypressHandler,
  { isActive }: { isActive: boolean },
) {
  const { subscribe, unsubscribe } = useKeypressContext();

  useEffect(() => {
    if (!isActive) return;
    subscribe(onKeypress);
    return () => unsubscribe(onKeypress);
  }, [isActive, onKeypress]);
}
```

---

## 二、状态层 (State Layer)

### 2.1 架构位置

```
┌─────────────────────────────────────────────────────────────┐
│                    状态层                                    │
│  useTextBuffer ───────────────────────────────────────────  │
│  ├─ TextBufferState (状态定义)                              │
│  ├─ textBufferReducer (Reducer 逻辑)                        │
│  ├─ Action Types (操作类型)                                 │
│  └─ Hook API (对外接口)                                     │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 状态结构

**TextBufferState** (`packages/cli/src/ui/components/shared/text-buffer.ts`)

```typescript
interface TextBufferState {
  // 逻辑文本
  lines: string[];                    // 按行分割的文本数组

  // 逻辑光标位置 (基于 code points)
  cursorRow: number;                  // 当前行索引
  cursorCol: number;                  // 当前列 (code point 索引)
  preferredCol: number | null;        // 垂直移动时保持的首选列

  // 视觉布局 (处理自动换行)
  viewportWidth: number;
  viewportHeight: number;
  visualLayout: {
    visualLines: string[];            // 换行后的视觉行
    visualToLogicalMap: Array<[number, number]>; // 视觉行到逻辑行的映射
  };

  // 撤销/重做栈
  undoStack: UndoFrame[];
  redoStack: UndoFrame[];

  // 剪贴板
  clipboard: string | null;

  // 选择 (Vim 模式)
  selectionAnchor: [number, number] | null;
}

interface UndoFrame {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
}
```

### 2.3 Action 类型系统

```typescript
export type TextBufferAction =
  // 文本操作
  | { type: 'set_text'; payload: string; pushToUndo?: boolean }
  | { type: 'insert'; payload: string }
  | { type: 'backspace' }
  | { type: 'delete' }

  // 光标移动
  | { type: 'move'; payload: { dir: Direction } }

  // 按词删除
  | { type: 'delete_word_left' }
  | { type: 'delete_word_right' }

  // 行操作
  | { type: 'kill_line_right' }
  | { type: 'kill_line_left' }

  // 撤销/重做
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'create_undo_snapshot' }

  // 视口
  | { type: 'set_viewport'; payload: { width: number; height: number } }

  // Vim 操作 (30+ 种)
  | { type: 'vim_delete_word_forward'; payload: { count: number } }
  | { type: 'vim_move_left'; payload: { count: number } }
  | { type: 'vim_insert_at_cursor' }
  // ... 更多
```

### 2.4 Reducer 架构

**分层 Reducer 设计：**

```typescript
// 第一层：纯业务逻辑
function textBufferReducerLogic(
  state: TextBufferState,
  action: TextBufferAction,
): TextBufferState {
  switch (action.type) {
    case 'insert':
      // 处理插入逻辑，返回新状态
    case 'backspace':
      // 处理退格逻辑
    // ...
  }
}

// 第二层：视觉布局计算
export function textBufferReducer(
  state: TextBufferState,
  action: TextBufferAction,
): TextBufferState {
  const newState = textBufferReducerLogic(state, action);

  // 当文本或视口变化时，重新计算视觉布局
  if (
    newState.lines !== state.lines ||
    newState.viewportWidth !== state.viewportWidth
  ) {
    return {
      ...newState,
      visualLayout: calculateLayout(newState.lines, newState.viewportWidth),
    };
  }

  return newState;
}
```

### 2.5 视觉布局计算

**逻辑到视觉的映射：**

```typescript
function calculateLayout(
  lines: string[],
  viewportWidth: number,
): VisualLayout {
  const visualLines: string[] = [];
  const visualToLogicalMap: Array<[number, number]> = [];

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let startCol = 0;

    // 按 viewportWidth 分割行
    while (startCol < line.length) {
      const chunk = sliceByDisplayWidth(line, startCol, viewportWidth);
      visualLines.push(chunk.text);
      visualToLogicalMap.push([lineIdx, chunk.startCol]);
      startCol = chunk.endCol;
    }

    // 空行处理
    if (line.length === 0) {
      visualLines.push('');
      visualToLogicalMap.push([lineIdx, 0]);
    }
  }

  return { visualLines, visualToLogicalMap };
}
```

### 2.6 useTextBuffer Hook API

```typescript
export function useTextBuffer(props: UseTextBufferProps): TextBuffer {
  // 内部使用 useReducer
  const [state, dispatch] = useReducer(textBufferReducer, initialState);

  // 派生状态
  const text = useMemo(() => lines.join('\n'), [lines]);
  const visualCursor = useMemo(
    () => calculateVisualCursorFromLayout(visualLayout, cursor),
    [visualLayout, cursor]
  );

  // 视口内可见行
  const viewportVisualLines = useMemo(
    () => allVisualLines.slice(visualScrollRow, visualScrollRow + viewport.height),
    [allVisualLines, visualScrollRow, viewport.height]
  );

  // 操作方法 (使用 useCallback 缓存)
  const insert = useCallback((ch: string, opts?) => {
    dispatch({ type: 'insert', payload: ch });
  }, []);

  const backspace = useCallback(() => {
    dispatch({ type: 'backspace' });
  }, []);

  const move = useCallback((dir: Direction) => {
    dispatch({ type: 'move', payload: { dir } });
  }, []);

  const undo = useCallback(() => {
    dispatch({ type: 'undo' });
  }, []);

  // 统一输入处理
  const handleInput = useCallback((input: string, key: Key) => {
    // 解析各种键盘事件，转换为对应的 dispatch
    if (key.name === 'return') newline();
    else if (key.name === 'backspace') backspace();
    else if (key.ctrl && key.name === 'a') move('home');
    else if (key.ctrl && key.name === 'e') move('end');
    // ...
  }, [...]);

  return {
    // 状态
    lines, text, cursor, preferredCol,
    visualCursor, visualScrollRow, viewportVisualLines,

    // 操作
    insert, backspace, move, undo, redo,
    handleInput, deleteWordLeft, deleteWordRight,
    // ...
  };
}
```

### 2.7 撤销/重做实现

```typescript
case 'undo': {
  if (state.undoStack.length === 0) return state;

  const current: UndoFrame = {
    lines: state.lines,
    cursorRow: state.cursorRow,
    cursorCol: state.cursorCol,
  };

  const previous = state.undoStack[state.undoStack.length - 1];

  return {
    ...state,
    lines: previous.lines,
    cursorRow: previous.cursorRow,
    cursorCol: previous.cursorCol,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: [current, ...state.redoStack],
  };
}
```

---

## 三、渲染层 (Rendering Layer)

### 3.1 架构位置

```
┌─────────────────────────────────────────────────────────────┐
│                    渲染层                                    │
│  BaseTextInput.tsx ───────────────────────────────────────  │
│  ├─ 输入框边框渲染                                          │
│  ├─ 多行文本渲染                                            │
│  ├─ 光标显示 (反色)                                         │
│  ├─ 占位符 (placeholder)                                    │
│  └─ Readline 快捷键处理                                     │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 组件结构

**BaseTextInput** (`packages/cli/src/ui/components/BaseTextInput.tsx`)

```typescript
interface BaseTextInputProps {
  buffer: TextBuffer;                    // 文本缓冲区
  onSubmit: (text: string) => void;      // 提交回调
  onKeypress?: (key: Key) => boolean;    // 按键拦截器
  showCursor?: boolean;                   // 是否显示光标
  placeholder?: string;                   // 占位文本
  prefix?: React.ReactNode;               // 前缀 (如 "> ")
  borderColor?: string;                   // 边框颜色
  isActive?: boolean;                     // 是否激活
  renderLine?: (opts: RenderLineOptions) => React.ReactNode;
}
```

### 3.3 渲染实现

**输入框容器：**

```tsx
<Box
  borderStyle="single"
  borderTop={true}
  borderBottom={true}
  borderLeft={false}
  borderRight={false}
  borderColor={resolvedBorderColor}
>
  {resolvedPrefix}
  <Box flexGrow={1} flexDirection="column">
    {/* 文本行渲染 */}
  </Box>
</Box>
```

**文本行渲染：**

```tsx
{linesToRender.map((lineText, idx) => {
  const absoluteVisualIndex = scrollVisualRow + idx;
  const isOnCursorLine = absoluteVisualIndex === cursorVisualRow;

  return (
    <Box key={idx} height={1}>
      {renderLine({
        lineText,
        isOnCursorLine,
        cursorCol: cursorVisualCol,
        showCursor,
        visualLineIndex: idx,
        absoluteVisualIndex,
        buffer,
        scrollVisualRow,
      })}
    </Box>
  );
})}
```

### 3.4 光标渲染

**默认光标渲染器：**

```tsx
export function defaultRenderLine({
  lineText,
  isOnCursorLine,
  cursorCol,
  showCursor,
}: RenderLineOptions): React.ReactNode {
  // 非光标行：普通渲染
  if (!isOnCursorLine || !showCursor) {
    return <Text>{lineText || ' '}</Text>;
  }

  const len = cpLen(lineText);

  // 光标在行尾：显示反色空格
  if (cursorCol >= len) {
    return (
      <Text>
        {lineText}
        {chalk.inverse(' ') + '\u200B'}
      </Text>
    );
  }

  // 光标在字符上：将该字符反色
  const before = cpSlice(lineText, 0, cursorCol);
  const cursorChar = cpSlice(lineText, cursorCol, cursorCol + 1);
  const after = cpSlice(lineText, cursorCol + 1);

  return (
    <Text>
      {before}
      {chalk.inverse(cursorChar)}
      {after}
    </Text>
  );
}
```

### 3.5 Readline 快捷键处理

```typescript
const handleKey = useCallback((key: Key) => {
  // 让消费者先拦截
  if (onKeypress?.(key)) return;

  // Submit (Enter)
  if (keyMatchers[Command.SUBMIT](key)) {
    if (buffer.text.trim()) {
      onSubmit(buffer.text);
      buffer.setText('');
    }
    return;
  }

  // Newline (Shift+Enter, Ctrl+Enter)
  if (keyMatchers[Command.NEWLINE](key)) {
    buffer.newline();
    return;
  }

  // Escape → clear input
  if (keyMatchers[Command.ESCAPE](key)) {
    buffer.setText('');
    return;
  }

  // Ctrl+A → home
  if (keyMatchers[Command.HOME](key)) {
    buffer.move('home');
    return;
  }

  // Ctrl+E → end
  if (keyMatchers[Command.END](key)) {
    buffer.move('end');
    return;
  }

  // Ctrl+K → kill to end of line
  if (keyMatchers[Command.KILL_LINE_RIGHT](key)) {
    buffer.killLineRight();
    return;
  }

  // Ctrl+U → kill to start of line
  if (keyMatchers[Command.KILL_LINE_LEFT](key)) {
    buffer.killLineLeft();
    return;
  }

  // Ctrl+W / Alt+Backspace → delete word backward
  if (keyMatchers[Command.DELETE_WORD_BACKWARD](key)) {
    buffer.deleteWordLeft();
    return;
  }

  // Ctrl+X → open in external editor
  if (keyMatchers[Command.OPEN_EXTERNAL_EDITOR](key)) {
    buffer.openInExternalEditor();
    return;
  }

  // 其他按键交给 buffer 处理
  buffer.handleInput(key);
}, [buffer, onSubmit, onKeypress]);
```

---

## 四、增强层 (Enhancement Layer)

### 4.1 架构位置

```
┌─────────────────────────────────────────────────────────────┐
│                    增强层                                    │
│  InputPrompt.tsx ─────────────────────────────────────────  │
│  ├─ 语法高亮 (parseInputForHighlighting)                    │
│  ├─ 历史导航 (useInputHistory)                              │
│  ├─ 命令补全 (useCommandCompletion)                         │
│  ├─ 反向搜索 (useReverseSearchCompletion)                   │
│  ├─ 图片粘贴 (clipboardUtils)                               │
│  ├─ 附件管理 (Attachments)                                  │
│  ├─ Shell 模式                                              │
│  └─ Vim 模式支持                                            │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 核心设计

**InputPrompt** (`packages/cli/src/ui/components/InputPrompt.tsx`) 是 `BaseTextInput` 的增强包装：

```tsx
export const InputPrompt: React.FC<InputPromptProps> = (props) => {
  // 各种增强功能状态
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [reverseSearchActive, setReverseSearchActive] = useState(false);
  const [shellModeActive, setShellModeActive] = useState(false);

  // 各种 Hooks
  const inputHistory = useInputHistory({...});
  const completion = useCommandCompletion({...});
  const shellHistory = useShellHistory({...});

  // 自定义按键处理
  const handleInput = useCallback((key: Key): boolean => {
    // 处理各种增强功能快捷键
    // 返回 true 表示已处理，false 传给 BaseTextInput
  }, [...]);

  // 语法高亮渲染
  const renderLineWithHighlighting = useCallback((opts) => {
    // 解析输入，对命令、文件路径等着色
  }, []);

  return (
    <>
      {/* 附件显示 */}
      {attachments.length > 0 && (
        <Box>...</Box>
      )}

      {/* 基础输入框 */}
      <BaseTextInput
        buffer={buffer}
        onSubmit={handleSubmitAndClear}
        onKeypress={handleInput}
        renderLine={renderLineWithHighlighting}
        {...}
      />

      {/* 补全建议 */}
      {shouldShowSuggestions && (
        <SuggestionsDisplay {...} />
      )}
    </>
  );
};
```

### 4.3 功能详解

#### 4.3.1 语法高亮

```typescript
const renderLineWithHighlighting = useCallback((opts: RenderLineOptions) => {
  const { lineText, isOnCursorLine, cursorCol, buffer } = opts;

  // 获取逻辑行信息
  const mapEntry = buf.visualToLogicalMap[absoluteVisualIndex];
  const [logicalLineIdx, logicalStartCol] = mapEntry;
  const logicalLine = buf.lines[logicalLineIdx] || '';

  // 解析为 token
  const tokens = parseInputForHighlighting(logicalLine, logicalLineIdx);

  // 构建显示段落
  const segments = buildSegmentsForVisualSlice(tokens, visualStart, visualEnd);

  // 渲染带颜色的段落
  return segments.map((seg, idx) => (
    <Text key={idx} color={getColorForTokenType(seg.type)}>
      {seg.text}
    </Text>
  ));
}, []);
```

#### 4.3.2 历史导航

```typescript
const useInputHistory = ({ userMessages, onSubmit, onChange }) => {
  const [historyIndex, setHistoryIndex] = useState(-1);

  const navigateUp = useCallback(() => {
    if (historyIndex < userMessages.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      onChange(userMessages[userMessages.length - 1 - newIndex]);
    }
  }, [historyIndex, userMessages]);

  const navigateDown = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      onChange(userMessages[userMessages.length - 1 - newIndex]);
    } else if (historyIndex === 0) {
      setHistoryIndex(-1);
      onChange('');
    }
  }, [historyIndex, userMessages]);

  return { navigateUp, navigateDown, resetHistoryNav };
};
```

#### 4.3.3 命令补全

```typescript
const useCommandCompletion = (buffer, dirs, slashCommands, ...) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // 根据当前输入生成建议
  useEffect(() => {
    const text = buffer.text;
    const cursorPos = buffer.cursor;

    // 文件路径补全
    if (text.includes('/') || text.startsWith('@')) {
      generateFileSuggestions(text, dirs);
    }
    // Slash 命令补全
    else if (text.startsWith('/')) {
      generateSlashCommandSuggestions(text, slashCommands);
    }
  }, [buffer.text, buffer.cursor]);

  const handleAutocomplete = (index: number) => {
    const suggestion = suggestions[index];
    buffer.replaceRange(..., suggestion.value);
  };

  return {
    suggestions,
    activeSuggestionIndex: activeIndex,
    showSuggestions,
    navigateUp: () => setActiveIndex(i => Math.max(0, i - 1)),
    navigateDown: () => setActiveIndex(i => Math.min(suggestions.length - 1, i + 1)),
    handleAutocomplete,
  };
};
```

#### 4.3.4 图片粘贴处理

```typescript
const handleClipboardImage = useCallback(async (validated = false) => {
  const hasImage = validated || (await clipboardHasImage());
  if (hasImage) {
    const imagePath = await saveClipboardImage(tempDir);
    if (imagePath) {
      const newAttachment: Attachment = {
        id: String(Date.now()),
        path: imagePath,
        filename: path.basename(imagePath),
      };
      setAttachments(prev => [...prev, newAttachment]);
    }
  }
}, []);

// 提交时转换附件为 @引用
const handleSubmitAndClear = useCallback((submittedValue: string) => {
  if (attachments.length > 0) {
    const attachmentRefs = attachments
      .map(att => `@${path.relative(targetDir, att.path)}`)
      .join(' ');
    finalValue = `${attachmentRefs}\n\n${submittedValue.trim()}`;
  }
  // ...
}, []);
```

### 4.4 按键拦截机制

```typescript
const handleInput = useCallback((key: Key): boolean => {
  // Vim 模式优先处理
  if (vimHandleInput && vimHandleInput(key)) {
    return true; // 已处理，不传给 BaseTextInput
  }

  // 反馈对话框处理
  if (uiState.isFeedbackDialogOpen) {
    if (FEEDBACK_DIALOG_KEYS.includes(key.name)) {
      return true;
    }
    uiActions.temporaryCloseFeedbackDialog();
  }

  // Shell 模式切换
  if (key.sequence === '!' && buffer.text === '') {
    setShellModeActive(!shellModeActive);
    buffer.setText('');
    return true;
  }

  // 反向搜索 (Ctrl+R)
  if (keyMatchers[Command.REVERSE_SEARCH](key)) {
    setReverseSearchActive(true);
    return true;
  }

  // 历史导航 (Ctrl+P/N)
  if (keyMatchers[Command.HISTORY_UP](key)) {
    inputHistory.navigateUp();
    return true;
  }

  // 补全导航
  if (completion.showSuggestions) {
    if (keyMatchers[Command.COMPLETION_UP](key)) {
      completion.navigateUp();
      return true;
    }
    if (keyMatchers[Command.ACCEPT_SUGGESTION](key)) {
      completion.handleAutocomplete(completion.activeSuggestionIndex);
      return true;
    }
  }

  // 未处理，传给 BaseTextInput
  return false;
}, [...]);
```

---

## 五、数据流 (Data Flow)

### 5.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           qwen-code 输入框数据流                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  用户交互层                                                                    │
│  ├─ 键盘输入 (stdin)                                                         │
│  ├─ 粘贴操作 (Bracketed Paste / Drag & Drop)                                │
│  └─ 外部编辑器 (Ctrl+X → vim/nano)                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  事件捕获层 (KeypressContext)                                                │
│  ├─ stdin.on('data') → handleRawKeypress()                                  │
│  ├─ readline.emitKeypressEvents() → handleKeypress()                        │
│  ├─ Kitty Protocol 解析                                                      │
│  ├─ Paste 模式检测 (ESC[200~ / ESC[201~)                                    │
│  └─ 标准化 Key 对象 → broadcast()                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  组件处理层                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │ InputPrompt.handleInput()                                              ││
│  │ ├─ Vim 模式拦截                                                        ││
│  │ ├─ 附件模式处理                                                        ││
│  │ ├─ 反向搜索/命令搜索                                                    ││
│  │ ├─ 历史导航 (Ctrl+P/N, ↑/↓)                                            ││
│  │ ├─ 补全导航 (Tab, ↑/↓)                                                 ││
│  │ ├─ Shell 模式切换 (!)                                                   ││
│  │ └─ 返回 false → 传给 BaseTextInput                                     ││
│  └─────────────────────────────────────────────────────────────────────────┘│
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  基础输入层 (BaseTextInput)                                                  │
│  ├─ Readline 快捷键 (Ctrl+A/E/K/U/W)                                        │
│  ├─ 基本编辑 (Backspace, Delete)                                            │
│  └─ 未处理 → buffer.handleInput()                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  状态管理层 (useTextBuffer)                                                  │
│  ├─ dispatch({ type: 'insert' | 'backspace' | 'move' | ... })              │
│  ├─ textBufferReducer() → 纯函数状态转换                                    │
│  ├─ 重新计算 visualLayout (如需要)                                          │
│  └─ React setState → 触发重渲染                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────────────────┐
│  渲染层                                                                       │
│  ├─ InputPrompt.renderLineWithHighlighting() → 语法高亮                     │
│  ├─ BaseTextInput.render() → Ink 组件树                                     │
│  ├─ defaultRenderLine() → chalk.inverse() 光标                             │
│  └─ Ink → stdout (ANSI escape sequences)                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 详细数据流示例

#### 场景：用户输入 "hello" 然后按 Enter

```
1. 用户按下 'h'
   stdin → 'h'
   ↓
2. KeypressContext
   handleRawKeypress('h') → parsePlainTextPrefix()
   ↓
   broadcast({ name: 'h', sequence: 'h', ctrl: false, meta: false, ... })
   ↓
3. InputPrompt (通过 useKeypress 订阅)
   handleInput({ name: 'h', ... })
   → 无特殊处理，返回 false
   ↓
4. BaseTextInput (通过 useKeypress 订阅)
   handleKey({ name: 'h', ... })
   → buffer.handleInput('h', key)
   ↓
5. useTextBuffer
   handleInput('h', { name: 'h' })
   → dispatch({ type: 'insert', payload: 'h' })
   ↓
6. textBufferReducer
   处理 'insert' → 更新 lines, cursorCol
   → 重新计算 visualLayout
   → 返回新 state
   ↓
7. React 重渲染
   BaseTextInput 渲染更新后的文本
   defaultRenderLine() → 光标在 'h' 后闪烁

[重复上述流程输入 'e', 'l', 'l', 'o']

8. 用户按下 Enter
   stdin → '\r' (或 Kitty CSI-u)
   ↓
9. KeypressContext
   broadcast({ name: 'return', sequence: '\r', ... })
   ↓
10. InputPrompt.handleInput()
    keyMatchers[Command.SUBMIT](key) → true
    → handleSubmitAndClear(buffer.text)
    → buffer.setText('') 清空
    → onSubmit('hello') 提交到上层
```

### 5.3 状态更新流程

```
Action 触发
    ↓
dispatch(action)
    ↓
textBufferReducer(state, action)
    ↓
┌─────────────────────────────────────────────────────────────┐
│  1. textBufferReducerLogic() 处理业务逻辑                    │
│     - 更新 lines, cursorRow, cursorCol                       │
│     - 管理 undoStack/redoStack                              │
│     - 返回 intermediateState                                │
└─────────────────────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────────────────────┐
│  2. 检测是否需要重新计算 visualLayout                        │
│     if (newState.lines !== state.lines ||                    │
│         newState.viewportWidth !== state.viewportWidth)      │
│       newState.visualLayout = calculateLayout(...)           │
└─────────────────────────────────────────────────────────────┘
    ↓
return newState
    ↓
React useReducer 更新状态
    ↓
依赖该状态的 useMemo 重新计算
    ├─ text = lines.join('\n')
    ├─ visualCursor = calculateVisualCursor(...)
    └─ viewportVisualLines = ...
    ↓
组件重渲染
```

### 5.4 性能优化策略

```typescript
// 1. 使用 useMemo 缓存派生状态
const text = useMemo(() => lines.join('\n'), [lines]);

const visualCursor = useMemo(
  () => calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]),
  [visualLayout, cursorRow, cursorCol]
);

// 2. 使用 useCallback 缓存回调函数
const insert = useCallback((ch: string) => {
  dispatch({ type: 'insert', payload: ch });
}, []);

// 3. Reducer 中避免不必要的状态复制
if (noChangeNeeded) {
  return state; // 返回原引用，不触发重渲染
}

// 4. 视觉布局按需计算
if (linesChanged || viewportChanged) {
  return { ...state, visualLayout: calculateLayout(...) };
}
return state;

// 5. 批量处理连续输入
// 在 handleInput 中，连续字符一次性 dispatch
for (const char of toCodePoints(ch)) {
  if (char.codePointAt(0) === 127) {
    dispatch({ type: 'backspace' });
  } else {
    currentText += char;
  }
}
if (currentText.length > 0) {
  dispatch({ type: 'insert', payload: currentText });
}
```

---

## 六、架构设计亮点

### 6.1 分层解耦

| 层级 | 职责 | 优点 |
|------|------|------|
| **KeypressContext** | 原始输入捕获与协议解析 | 统一处理 Kitty/legacy 终端 |
| **useTextBuffer** | 纯状态管理 | 可测试、无副作用 |
| **BaseTextInput** | 基础渲染 + readline | 可复用、简洁 |
| **InputPrompt** | 业务功能增强 | 灵活扩展 |

### 6.2 视觉/逻辑分离

```
逻辑层 (Logical)          视觉层 (Visual)
─────────────             ─────────────
lines: ['hello world']    visualLines: ['hello ', 'world']
cursor: [0, 6]            visualCursor: [1, 0]
                          visualToLogicalMap: [[0,0], [0,6]]

优势：
- 自动换行处理
- 光标在换行处正确显示
- 支持水平滚动
```

### 6.3 命令模式 (Command Pattern)

```typescript
// 所有操作为纯函数 Action
dispatch({ type: 'insert', payload: 'text' })
dispatch({ type: 'delete_word_left' })
dispatch({ type: 'move', payload: { dir: 'wordRight' } })

// 优点：
- 易于实现撤销/重做
- 可序列化、可记录
- 便于测试
```

### 6.4 插件化设计

```typescript
// 自定义渲染行
renderLine?: (opts: RenderLineOptions) => React.ReactNode

// 按键拦截
onKeypress?: (key: Key) => boolean

// Vim 模式集成
vimHandleInput?: (key: Key) => boolean
```

---

## 七、总结

qwen-code 的 CLI 文本输入框通过**五层架构**实现了工业级的文本编辑体验：

1. **键盘监听层**：统一处理各种终端输入协议
2. **状态层**：纯函数 reducer 管理复杂文本状态
3. **渲染层**：基于 Ink 的声明式 UI 渲染
4. **增强层**：灵活扩展各种业务功能
5. **数据流**：单向数据流，性能优化到位

这种架构设计使得代码具有高度的**可维护性**、**可测试性**和**可扩展性**，是构建复杂 TUI 应用的优秀范例。

# Keyboard Input Rewrite Implementation Plan

> **For Claude:** Use the `executing-plans` skill to implement this plan task-by-task.

**Goal:** 将 InputBox 从单行 `ink-text-input` 重构为支持多行输入、Bracketed Paste、Readline 快捷键和撤销/重做的五层架构。

**Architecture:** 五层架构：① KeypressContext（pub-sub，Bracketed Paste 检测）→ ② useInputBuffer（reducer 全状态管理，多行/undo）→ ③ MultilineTextInput（自定义渲染器）→ ④ useInputHistory（独立 hook）→ ⑤ InputBox（增强组装层）。右侧面板保留为扩展槽，Tab 切换焦点。

**Tech Stack:** TypeScript, React, Ink (TUI), useReducer, useCallback, useMemo

---

## Task 1：KeypressContext — Bracketed Paste 检测与事件总线

**Files:**
- Create: `src/tui/contexts/KeypressContext.tsx`
- Modify: `src/tui/index.tsx`（wrap App with KeypressProvider）

### Step 1: 创建 KeypressContext.tsx

```tsx
// src/tui/contexts/KeypressContext.tsx
import React, {
    createContext, useContext, useEffect, useRef, useCallback,
} from 'react'

export interface PasteKey {
    paste: true
    sequence: string  // 完整粘贴内容
}

type PasteHandler = (key: PasteKey) => void

interface KeypressContextValue {
    subscribePaste:   (handler: PasteHandler) => void
    unsubscribePaste: (handler: PasteHandler) => void
}

const KeypressContext = createContext<KeypressContextValue | null>(null)

const PASTE_START = '\x1b[200~'
const PASTE_END   = '\x1b[201~'

export function KeypressProvider({ children }: { children: React.ReactNode }) {
    const subscribers  = useRef<Set<PasteHandler>>(new Set())
    const pasteBuffer  = useRef('')
    const isPasting    = useRef(false)

    const broadcast = useCallback((key: PasteKey) => {
        for (const h of subscribers.current) h(key)
    }, [])

    useEffect(() => {
        const handleData = (data: Buffer) => {
            const str = data.toString()

            if (!isPasting.current && str.includes(PASTE_START)) {
                isPasting.current = true
                // 取 PASTE_START 之后的内容（同一 chunk 可能有后续内容）
                pasteBuffer.current = str.slice(str.indexOf(PASTE_START) + PASTE_START.length)
                // 检查同一 chunk 内是否已有结束标记
                if (pasteBuffer.current.includes(PASTE_END)) {
                    const end = pasteBuffer.current.indexOf(PASTE_END)
                    const text = pasteBuffer.current.slice(0, end)
                    isPasting.current = false
                    pasteBuffer.current = ''
                    broadcast({ paste: true, sequence: text })
                }
                return
            }

            if (isPasting.current) {
                if (str.includes(PASTE_END)) {
                    pasteBuffer.current += str.slice(0, str.indexOf(PASTE_END))
                    const text = pasteBuffer.current
                    isPasting.current = false
                    pasteBuffer.current = ''
                    broadcast({ paste: true, sequence: text })
                } else {
                    pasteBuffer.current += str
                }
                return
            }
            // 非 paste 数据：由 Ink 的 useInput 正常处理，这里不干预
        }

        process.stdin.on('data', handleData)
        return () => { process.stdin.off('data', handleData) }
    }, [broadcast])

    const subscribePaste   = useCallback((h: PasteHandler) => { subscribers.current.add(h) }, [])
    const unsubscribePaste = useCallback((h: PasteHandler) => { subscribers.current.delete(h) }, [])

    return (
        <KeypressContext.Provider value={{ subscribePaste, unsubscribePaste }}>
            {children}
        </KeypressContext.Provider>
    )
}

export function useKeypressContext() {
    const ctx = useContext(KeypressContext)
    if (!ctx) throw new Error('useKeypressContext must be used inside KeypressProvider')
    return ctx
}

/** 订阅 Bracketed Paste 事件。isActive=false 时自动取消订阅。 */
export function usePasteHandler(
    handler: PasteHandler,
    { isActive }: { isActive: boolean },
) {
    const { subscribePaste, unsubscribePaste } = useKeypressContext()
    const handlerRef = useRef(handler)
    handlerRef.current = handler

    // 稳定引用，避免每次渲染都 subscribe/unsubscribe
    const stable = useCallback((key: PasteKey) => handlerRef.current(key), [])

    useEffect(() => {
        if (!isActive) return
        subscribePaste(stable)
        return () => unsubscribePaste(stable)
    }, [isActive, stable, subscribePaste, unsubscribePaste])
}
```

### Step 2: 修改 src/tui/index.tsx，用 KeypressProvider 包裹 App

当前文件内容（参考）：

```tsx
// src/tui/index.tsx — 修改前（关键部分）
export function startTUI(options: ClientOptions) {
    const instance = render(
        <App clientOptions={options} clearScreen={...} />,
    )
}
```

修改后：

```tsx
// src/tui/index.tsx — 修改后
import { KeypressProvider } from './contexts/KeypressContext.js'

export function startTUI(options: ClientOptions) {
    const instance = render(
        <KeypressProvider>
            <App
                clientOptions={options}
                clearScreen={() => {
                    instance.clear()
                    process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
                }}
            />
        </KeypressProvider>,
    )
}
```

### Step 3: 构建验证

```bash
cd /home/xjingyao/code/opencode_lite/lop_minimal
npm run build
```

期望：编译通过，无类型错误。

### Step 4: 手动验证 Paste 检测

```bash
npm run dev
```

在终端里复制一段多行文本（如两行代码），粘贴到输入框。期望：内容被整体插入，**不会**触发自动提交。

### Step 5: Commit

```bash
git add src/tui/contexts/KeypressContext.tsx src/tui/index.tsx
git commit -m "feat(tui): add KeypressContext with Bracketed Paste detection"
```

---

## Task 2：useInputBuffer — Reducer 文本缓冲区

**Files:**
- Create: `src/tui/hooks/useInputBuffer.ts`

### Step 1: 创建 useInputBuffer.ts（完整实现）

```ts
// src/tui/hooks/useInputBuffer.ts
import { useReducer, useCallback, useMemo } from 'react'

// ─── 类型 ───────────────────────────────────────────────────────────────────

interface UndoFrame {
    lines: string[]
    cursorRow: number
    cursorCol: number
}

interface InputBufferState {
    lines:     string[]
    cursorRow: number
    cursorCol: number
    undoStack: UndoFrame[]
    redoStack: UndoFrame[]
}

type MoveDir = 'left' | 'right' | 'up' | 'down' | 'home' | 'end' | 'doc_start' | 'doc_end'

export type InputBufferAction =
    | { type: 'insert';            payload: string }
    | { type: 'newline' }
    | { type: 'backspace' }
    | { type: 'delete' }
    | { type: 'move';              dir: MoveDir }
    | { type: 'move_word';         dir: 'left' | 'right' }
    | { type: 'kill_line_right' }
    | { type: 'kill_line_left' }
    | { type: 'delete_word_left' }
    | { type: 'set_text';          payload: string }
    | { type: 'clear' }
    | { type: 'snapshot' }
    | { type: 'undo' }
    | { type: 'redo' }

// ─── Reducer ────────────────────────────────────────────────────────────────

const INITIAL: InputBufferState = {
    lines: [''], cursorRow: 0, cursorCol: 0,
    undoStack: [], redoStack: [],
}

function reducer(state: InputBufferState, action: InputBufferAction): InputBufferState {
    const { lines, cursorRow, cursorCol } = state

    switch (action.type) {

        case 'insert': {
            const line    = lines[cursorRow] ?? ''
            const newLine = line.slice(0, cursorCol) + action.payload + line.slice(cursorCol)
            const next    = [...lines]
            next[cursorRow] = newLine
            return { ...state, lines: next, cursorCol: cursorCol + action.payload.length }
        }

        case 'newline': {
            const line   = lines[cursorRow] ?? ''
            const before = line.slice(0, cursorCol)
            const after  = line.slice(cursorCol)
            const next = [
                ...lines.slice(0, cursorRow),
                before,
                after,
                ...lines.slice(cursorRow + 1),
            ]
            return { ...state, lines: next, cursorRow: cursorRow + 1, cursorCol: 0 }
        }

        case 'backspace': {
            if (cursorCol > 0) {
                const line = lines[cursorRow]
                const next = [...lines]
                next[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol)
                return { ...state, lines: next, cursorCol: cursorCol - 1 }
            }
            if (cursorRow > 0) {
                const prevLine = lines[cursorRow - 1]
                const currLine = lines[cursorRow]
                const next = [
                    ...lines.slice(0, cursorRow - 1),
                    prevLine + currLine,
                    ...lines.slice(cursorRow + 1),
                ]
                return { ...state, lines: next, cursorRow: cursorRow - 1, cursorCol: prevLine.length }
            }
            return state
        }

        case 'delete': {
            const line = lines[cursorRow]
            if (cursorCol < line.length) {
                const next = [...lines]
                next[cursorRow] = line.slice(0, cursorCol) + line.slice(cursorCol + 1)
                return { ...state, lines: next }
            }
            if (cursorRow < lines.length - 1) {
                const next = [
                    ...lines.slice(0, cursorRow),
                    line + lines[cursorRow + 1],
                    ...lines.slice(cursorRow + 2),
                ]
                return { ...state, lines: next }
            }
            return state
        }

        case 'move': {
            switch (action.dir) {
                case 'left': {
                    if (cursorCol > 0) return { ...state, cursorCol: cursorCol - 1 }
                    if (cursorRow > 0) return {
                        ...state,
                        cursorRow: cursorRow - 1,
                        cursorCol: lines[cursorRow - 1].length,
                    }
                    return state
                }
                case 'right': {
                    const len = lines[cursorRow].length
                    if (cursorCol < len) return { ...state, cursorCol: cursorCol + 1 }
                    if (cursorRow < lines.length - 1) return {
                        ...state,
                        cursorRow: cursorRow + 1,
                        cursorCol: 0,
                    }
                    return state
                }
                case 'up': {
                    if (cursorRow > 0) return {
                        ...state,
                        cursorRow: cursorRow - 1,
                        cursorCol: Math.min(cursorCol, lines[cursorRow - 1].length),
                    }
                    return state
                }
                case 'down': {
                    if (cursorRow < lines.length - 1) return {
                        ...state,
                        cursorRow: cursorRow + 1,
                        cursorCol: Math.min(cursorCol, lines[cursorRow + 1].length),
                    }
                    return state
                }
                case 'home':      return { ...state, cursorCol: 0 }
                case 'end':       return { ...state, cursorCol: lines[cursorRow].length }
                case 'doc_start': return { ...state, cursorRow: 0, cursorCol: 0 }
                case 'doc_end': {
                    const last = lines.length - 1
                    return { ...state, cursorRow: last, cursorCol: lines[last].length }
                }
            }
            return state
        }

        case 'move_word': {
            const line = lines[cursorRow]
            let col = cursorCol
            if (action.dir === 'left') {
                while (col > 0 && line[col - 1] === ' ') col--
                while (col > 0 && line[col - 1] !== ' ') col--
            } else {
                while (col < line.length && line[col] !== ' ') col++
                while (col < line.length && line[col] === ' ') col++
            }
            return { ...state, cursorCol: col }
        }

        case 'kill_line_right': {
            const line = lines[cursorRow]
            if (cursorCol < line.length) {
                const next = [...lines]
                next[cursorRow] = line.slice(0, cursorCol)
                return { ...state, lines: next }
            }
            if (cursorRow < lines.length - 1) {
                // 删除当前行末的换行符（合并下一行）
                const next = [
                    ...lines.slice(0, cursorRow),
                    line + lines[cursorRow + 1],
                    ...lines.slice(cursorRow + 2),
                ]
                return { ...state, lines: next }
            }
            return state
        }

        case 'kill_line_left': {
            const line = lines[cursorRow]
            const next = [...lines]
            next[cursorRow] = line.slice(cursorCol)
            return { ...state, lines: next, cursorCol: 0 }
        }

        case 'delete_word_left': {
            const line = lines[cursorRow]
            let col = cursorCol
            while (col > 0 && line[col - 1] === ' ') col--
            while (col > 0 && line[col - 1] !== ' ') col--
            const next = [...lines]
            next[cursorRow] = line.slice(0, col) + line.slice(cursorCol)
            return { ...state, lines: next, cursorCol: col }
        }

        case 'set_text': {
            const newLines = action.payload.split('\n')
            const last = newLines.length - 1
            return {
                ...state,
                lines: newLines,
                cursorRow: last,
                cursorCol: newLines[last].length,
                redoStack: [],
            }
        }

        case 'clear': {
            return { ...state, lines: [''], cursorRow: 0, cursorCol: 0 }
        }

        case 'snapshot': {
            const frame: UndoFrame = { lines, cursorRow, cursorCol }
            return { ...state, undoStack: [...state.undoStack, frame], redoStack: [] }
        }

        case 'undo': {
            if (state.undoStack.length === 0) return state
            const prev    = state.undoStack[state.undoStack.length - 1]
            const current: UndoFrame = { lines, cursorRow, cursorCol }
            return {
                ...state,
                lines:     prev.lines,
                cursorRow: prev.cursorRow,
                cursorCol: prev.cursorCol,
                undoStack: state.undoStack.slice(0, -1),
                redoStack: [current, ...state.redoStack],
            }
        }

        case 'redo': {
            if (state.redoStack.length === 0) return state
            const next    = state.redoStack[0]
            const current: UndoFrame = { lines, cursorRow, cursorCol }
            return {
                ...state,
                lines:     next.lines,
                cursorRow: next.cursorRow,
                cursorCol: next.cursorCol,
                undoStack: [...state.undoStack, current],
                redoStack: state.redoStack.slice(1),
            }
        }

        default:
            return state
    }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useInputBuffer() {
    const [state, dispatch] = useReducer(reducer, INITIAL)

    const text = useMemo(() => state.lines.join('\n'), [state.lines])

    const insert          = useCallback((payload: string) => dispatch({ type: 'insert', payload }), [])
    const newline         = useCallback(() => dispatch({ type: 'newline' }), [])
    const backspace       = useCallback(() => dispatch({ type: 'backspace' }), [])
    const del             = useCallback(() => dispatch({ type: 'delete' }), [])
    const move            = useCallback((dir: MoveDir) => dispatch({ type: 'move', dir }), [])
    const moveWord        = useCallback((dir: 'left' | 'right') => dispatch({ type: 'move_word', dir }), [])
    const killLineRight   = useCallback(() => dispatch({ type: 'kill_line_right' }), [])
    const killLineLeft    = useCallback(() => dispatch({ type: 'kill_line_left' }), [])
    const deleteWordLeft  = useCallback(() => dispatch({ type: 'delete_word_left' }), [])
    const setText         = useCallback((payload: string) => dispatch({ type: 'set_text', payload }), [])
    const clear           = useCallback(() => dispatch({ type: 'clear' }), [])
    const snapshot        = useCallback(() => dispatch({ type: 'snapshot' }), [])
    const undo            = useCallback(() => dispatch({ type: 'undo' }), [])
    const redo            = useCallback(() => dispatch({ type: 'redo' }), [])

    return {
        text,
        lines:     state.lines,
        cursor:    { row: state.cursorRow, col: state.cursorCol },
        hasUndo:   state.undoStack.length > 0,
        hasRedo:   state.redoStack.length > 0,
        insert, newline, backspace, delete: del,
        move, moveWord, killLineRight, killLineLeft, deleteWordLeft,
        setText, clear, snapshot, undo, redo,
    }
}

export type InputBuffer = ReturnType<typeof useInputBuffer>
```

### Step 2: 构建验证

```bash
npm run build
```

期望：编译通过。

### Step 3: Commit

```bash
git add src/tui/hooks/useInputBuffer.ts
git commit -m "feat(tui): add useInputBuffer reducer hook with multi-line and undo support"
```

---

## Task 3：useInputHistory — 提取历史记录 Hook

**Files:**
- Create: `src/tui/hooks/useInputHistory.ts`

### Step 1: 创建 useInputHistory.ts

```ts
// src/tui/hooks/useInputHistory.ts
import { useState, useCallback } from 'react'
import type { InputBuffer } from './useInputBuffer.js'

export function useInputHistory(buffer: InputBuffer) {
    const [history, setHistory] = useState<string[]>([])
    const [index, setIndex]     = useState(-1)

    /** 提交时调用：保存到历史并重置索引 */
    const push = useCallback((text: string) => {
        if (!text.trim()) return
        setHistory(prev => [...prev, text])
        setIndex(-1)
    }, [])

    /** ↑ 导航到更旧的历史 */
    const navigateUp = useCallback(() => {
        setIndex(prev => {
            const next = Math.min(prev + 1, history.length - 1)
            if (next !== prev && history.length > 0) {
                buffer.setText(history[history.length - 1 - next])
            }
            return next
        })
    }, [history, buffer])

    /** ↓ 导航到更新的历史；到底时清空输入框 */
    const navigateDown = useCallback(() => {
        setIndex(prev => {
            if (prev > 0) {
                const next = prev - 1
                buffer.setText(history[history.length - 1 - next])
                return next
            }
            if (prev === 0) {
                buffer.clear()
                return -1
            }
            return prev
        })
    }, [history, buffer])

    const reset = useCallback(() => setIndex(-1), [])

    return { push, navigateUp, navigateDown, reset, index }
}
```

### Step 2: 构建验证

```bash
npm run build
```

### Step 3: Commit

```bash
git add src/tui/hooks/useInputHistory.ts
git commit -m "feat(tui): extract useInputHistory hook from InputBox"
```

---

## Task 4：MultilineTextInput — 自定义多行渲染器

**Files:**
- Create: `src/tui/components/MultilineTextInput.tsx`

### Step 1: 创建 MultilineTextInput.tsx

```tsx
// src/tui/components/MultilineTextInput.tsx
import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import type { InputBuffer } from '../hooks/useInputBuffer.js'

interface MultilineTextInputProps {
    buffer:           InputBuffer
    placeholder?:     string
    showCursor?:      boolean
    focus?:           boolean
    maxVisibleLines?: number   // 超过后滚动，默认 8
}

export const MultilineTextInput: React.FC<MultilineTextInputProps> = ({
    buffer,
    placeholder,
    showCursor  = true,
    focus       = true,
    maxVisibleLines = 8,
}) => {
    const { lines, cursor } = buffer

    // 计算可视窗口起始行
    const startRow = useMemo(() => {
        if (lines.length <= maxVisibleLines) return 0
        const half = Math.floor(maxVisibleLines / 2)
        return Math.max(0, Math.min(cursor.row - half, lines.length - maxVisibleLines))
    }, [lines.length, cursor.row, maxVisibleLines])

    const visibleLines = lines.slice(startRow, startRow + maxVisibleLines)
    const isEmpty      = lines.length === 1 && lines[0] === ''

    // 空状态 + 有 placeholder
    if (isEmpty && placeholder) {
        if (!focus || !showCursor) {
            return <Text dimColor>{placeholder}</Text>
        }
        return (
            <Box>
                <Text inverse>{' '}</Text>
                <Text dimColor>{placeholder}</Text>
            </Box>
        )
    }

    return (
        <Box flexDirection="column">
            {visibleLines.map((line, idx) => {
                const absRow      = startRow + idx
                const isCursorRow = absRow === cursor.row

                if (!isCursorRow || !showCursor || !focus) {
                    return <Text key={absRow}>{line}</Text>
                }

                // 光标行：反色显示光标所在字符
                const col    = cursor.col
                const before = line.slice(0, col)
                const ch     = line[col] ?? ' '   // 行尾时用空格占位
                const after  = line.slice(col + 1)

                return (
                    <Text key={absRow}>
                        {before}
                        <Text inverse>{ch}</Text>
                        {after}
                    </Text>
                )
            })}
        </Box>
    )
}
```

### Step 2: 构建验证

```bash
npm run build
```

### Step 3: 简单冒烟测试

启动应用：

```bash
npm run dev
```

**此时 MultilineTextInput 尚未被 InputBox 使用，只是确认组件能编译。**

### Step 4: Commit

```bash
git add src/tui/components/MultilineTextInput.tsx
git commit -m "feat(tui): add MultilineTextInput component with cursor highlighting"
```

---

## Task 5：InputBox 改写 — 完整组装层

**Files:**
- Modify: `src/tui/components/InputBox.tsx`（完全重写）

> **注意**：这一步是破坏性修改，完成后需完整手动测试。

### Step 1: 重写 InputBox.tsx

```tsx
// src/tui/components/InputBox.tsx
import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { CommandCompletion } from './CommandCompletion.js'
import { MultilineTextInput } from './MultilineTextInput.js'
import { useInputBuffer } from '../hooks/useInputBuffer.js'
import { useInputHistory } from '../hooks/useInputHistory.js'
import { usePasteHandler } from '../contexts/KeypressContext.js'
import type { SlashCommand } from '../../commands/types.js'
import { useTheme } from '../themes/ThemeContext.js'

interface InputBoxProps {
    onSubmit: (value: string) => void
    onClear:  () => void
    disabled?:  boolean
    commands?:  SlashCommand[]
}

export const InputBox: React.FC<InputBoxProps> = ({
    onSubmit,
    onClear,
    disabled  = false,
    commands  = [],
}) => {
    const { colors }                  = useTheme()
    const buffer                      = useInputBuffer()
    const history                     = useInputHistory(buffer)
    const [focusIndex, setFocusIndex] = useState(0)
    const [selectedIndex, setSelectedIndex] = useState(0)

    const isMainFocused = focusIndex === 0 && !disabled

    // ── Slash 命令补全 ────────────────────────────────────────────────────────
    const text = buffer.text

    const matchedCommands = useMemo(() => {
        if (!text.startsWith('/')) return []
        const partial = text.slice(1).toLowerCase()
        if (text.includes('\n')) return []   // 多行时不显示补全
        if (!partial) return commands
        return commands.filter(cmd => cmd.name.startsWith(partial))
    }, [text, commands])

    const showCompletion = useMemo(
        () => text.startsWith('/') && !text.includes(' ') && !text.includes('\n') && matchedCommands.length > 0,
        [text, matchedCommands.length],
    )

    const selectedCommand = matchedCommands[selectedIndex] ?? null

    useEffect(() => setSelectedIndex(0), [text, matchedCommands.length])

    // ── Bracketed Paste（来自 KeypressContext）────────────────────────────────
    usePasteHandler(
        useCallback((key) => {
            buffer.snapshot()
            buffer.insert(key.sequence)
        }, [buffer]),
        { isActive: isMainFocused },
    )

    // ── 键盘处理（Ink useInput）───────────────────────────────────────────────
    useInput((input, key) => {
        if (disabled) return

        // Tab：补全 or 切换面板
        if (key.tab) {
            if (focusIndex === 0 && showCompletion && selectedCommand) {
                buffer.setText(`/${selectedCommand.name} `)
                return
            }
            setFocusIndex(i => (i + 1) % 2)
            return
        }

        // 右侧面板获得焦点时，主输入框不处理按键
        if (focusIndex !== 0) return

        // 补全列表导航
        if (showCompletion) {
            if (key.upArrow) {
                setSelectedIndex(i => (i - 1 + matchedCommands.length) % matchedCommands.length)
                return
            }
            if (key.downArrow) {
                setSelectedIndex(i => (i + 1) % matchedCommands.length)
                return
            }
            if (key.escape) {
                buffer.insert(' ')    // 空格关闭补全
                return
            }
        }

        // Enter（不带 Shift）：提交
        if (key.return && !key.shift) {
            if (!text.trim()) return
            if (showCompletion && selectedCommand) {
                buffer.setText(`/${selectedCommand.name} `)
                return
            }
            buffer.snapshot()
            history.push(text)
            onSubmit(text)
            buffer.clear()
            return
        }

        // Shift+Enter：换行
        if (key.return && key.shift) {
            buffer.snapshot()
            buffer.newline()
            return
        }

        // Readline 快捷键（Ctrl+*）
        if (key.ctrl) {
            switch (input) {
                case 'a': buffer.move('home');                      return
                case 'e': buffer.move('end');                       return
                case 'k': buffer.snapshot(); buffer.killLineRight(); return
                case 'u': buffer.snapshot(); buffer.killLineLeft();  return
                case 'w': buffer.snapshot(); buffer.deleteWordLeft();return
                case 'z': buffer.undo();                            return
                case 'y': buffer.redo();                            return
                case 'l': onClear();                                return
            }
        }

        // Alt/Meta 快捷键（词跳转）
        if (key.meta) {
            if (key.leftArrow)  { buffer.moveWord('left');  return }
            if (key.rightArrow) { buffer.moveWord('right'); return }
            if (input === 'b')  { buffer.moveWord('left');  return }
            if (input === 'f')  { buffer.moveWord('right'); return }
        }

        // 光标移动 & 历史导航（上下箭头）
        if (!showCompletion) {
            if (key.upArrow) {
                // 多行时：光标移动；单行时：历史导航
                if (buffer.lines.length > 1 && buffer.cursor.row > 0) {
                    buffer.move('up')
                } else {
                    history.navigateUp()
                }
                return
            }
            if (key.downArrow) {
                const lastRow = buffer.lines.length - 1
                if (buffer.lines.length > 1 && buffer.cursor.row < lastRow) {
                    buffer.move('down')
                } else {
                    history.navigateDown()
                }
                return
            }
        }

        if (key.leftArrow)  { buffer.move('left');  return }
        if (key.rightArrow) { buffer.move('right'); return }
        if (key.backspace)  { buffer.backspace();   return }
        if (key.delete)     { buffer.delete();      return }

        // 普通字符输入
        if (input && !key.ctrl && !key.meta) {
            buffer.insert(input)
        }
    })

    // ── 渲染 ──────────────────────────────────────────────────────────────────
    return (
        <Box flexDirection="column" marginTop={0}>
            <Box flexDirection="row" gap={0}>

                {/* 左：主输入框 */}
                <Box
                    borderStyle="round"
                    borderColor={focusIndex === 0 ? colors.border.focused : colors.border.default}
                    flexGrow={focusIndex === 0 ? 8 : 2}
                    flexBasis={0}
                    paddingLeft={0}
                >
                    <Text bold color={disabled
                        ? colors.text.secondary
                        : focusIndex === 0 ? colors.border.focused : colors.text.secondary
                    }>
                        {disabled ? '...' : '> '}
                    </Text>
                    <Box flexGrow={1}>
                        <MultilineTextInput
                            buffer={buffer}
                            placeholder={disabled ? 'Waiting...' : 'Message or /help...'}
                            showCursor={isMainFocused}
                            focus={isMainFocused}
                        />
                    </Box>
                </Box>

                {/* 右：扩展槽（Tab 可切入，预留未来功能） */}
                <Box
                    borderStyle="round"
                    borderColor={focusIndex === 1 ? colors.status.success : colors.border.default}
                    flexGrow={focusIndex === 1 ? 8 : 2}
                    flexBasis={0}
                >
                    <Text bold color={focusIndex === 1 ? colors.status.success : colors.text.secondary}>
                        {'[+] '}
                    </Text>
                    {/* TODO: 右侧面板功能扩展（Shell 模式 / 文件附件 / 图片输入等） */}
                    <Text dimColor color={colors.text.secondary}>
                        {focusIndex === 1 ? 'coming soon' : ''}
                    </Text>
                </Box>

            </Box>

            {/* 补全列表 */}
            {showCompletion && focusIndex === 0 && (
                <CommandCompletion
                    commands={matchedCommands}
                    selectedIndex={selectedIndex}
                    inputPrefix={text}
                />
            )}
        </Box>
    )
}
```

### Step 2: 构建验证

```bash
npm run build
```

期望：编译通过，无类型错误。如有报错，先修复再继续。

### Step 3: 功能手动验证清单

启动应用：

```bash
npm run dev
```

逐项测试：

| 功能 | 测试方法 | 期望 |
|------|---------|------|
| 普通输入 | 直接打字 | 字符正常显示，反色光标跟随 |
| 光标移动 | ←/→ 箭头 | 光标在字符间移动 |
| Ctrl+A / Ctrl+E | 按键 | 光标跳到行首/行尾 |
| Ctrl+K | 按键 | 删除光标到行尾 |
| Ctrl+W | 按键 | 删除前一个词 |
| Shift+Enter 换行 | Shift+Enter | 新增一行，光标到行首 |
| ↑/↓ 多行光标 | 多行后按箭头 | 在行间移动 |
| Ctrl+Z undo | 输入文字后撤销 | 恢复之前状态 |
| 历史导航 | 提交消息后按 ↑ | 恢复上条输入 |
| Tab 切换面板 | Tab 键 | 焦点在左右面板切换 |
| 粘贴多行 | 复制两行代码粘贴 | 整体插入，不自动提交 |
| /help 补全 | 输入 `/h` | 显示匹配命令列表 |

### Step 4: Commit

```bash
git add src/tui/components/InputBox.tsx
git commit -m "feat(tui): rewrite InputBox with multi-line, readline, undo, paste support"
```

---

## Task 6：清理 — 移除 ink-text-input 依赖（可选）

**前提**：Task 5 完成且测试通过后再做。

### Step 1: 确认无其他引用

```bash
grep -r "ink-text-input" src/
```

期望：无输出（或只有未使用的 import）。

### Step 2: 移除依赖

```bash
npm uninstall ink-text-input
```

### Step 3: 构建确认

```bash
npm run build
```

### Step 4: Commit

```bash
git add package.json package-lock.json
git commit -m "chore: remove ink-text-input dependency"
```

---

## 整体完成验证

```bash
npm run build && npm run dev
```

按照 Task 5 Step 3 的验证清单完整过一遍，确认所有功能正常。

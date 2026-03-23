# lop_minimal 鼠标输入支持设计文档

> 为 TUI 添加鼠标交互能力

## 1. 概述

### 1.1 目标

为 lop_minimal 的 TUI 界面添加鼠标支持，实现：
- 鼠标点击交互
- 滚轮滚动
- 鼠标悬停效果
- 点击选择和确认

### 1.2 终端鼠标支持原理

终端默认不发送鼠标事件，需要通过 **ANSI 转义序列** 启用鼠标跟踪模式：

```
启用: ESC [ ? <mode> h
禁用: ESC [ ? <mode> l
```

#### 鼠标跟踪模式

| 模式 | 名称 | 说明 | 推荐 |
|------|------|------|------|
| 1000 | Normal Tracking | 按钮按下/释放时发送事件 | ✅ |
| 1002 | Button-Event Tracking | 按钮事件 + 拖动 | ✅ |
| 1003 | Any-Event Tracking | 所有鼠标移动都发送 | ❌ 性能差 |
| 1006 | SGR Extended Mode | 十进制坐标，支持坐标 > 223 | ✅ 推荐 |
| 1015 | URXVT Extended Mode | 另一种扩展模式 | ⚠️ |

**推荐组合**：启用 1000 + 1006，或 1002 + 1006

### 1.3 终端兼容性

| 终端 | 支持情况 |
|------|----------|
| iTerm2 | ✅ 完全支持 |
| macOS Terminal.app | ✅ 支持 |
| Windows Terminal | ✅ 支持 |
| VS Code 终端 | ✅ 支持 |
| GNOME Terminal | ✅ 支持 |
| tmux | ⚠️ 需要配置 |
| 某些简单终端 | ❌ 不支持 |

## 2. 架构设计

### 2.1 目录结构

```
src/tui/
├── mouse/
│   ├── index.ts           # 导出
│   ├── types.ts           # 鼠标事件类型
│   ├── tracking.ts        # 启用/禁用鼠标跟踪
│   ├── parser.ts          # 解析鼠标事件
│   └── useMouse.ts        # React Hook
├── hooks/
│   └── ...
└── components/
    └── ClickableBox.tsx   # 可点击组件
```

### 2.2 数据流

```
┌─────────────────────────────────────────────────────────────┐
│                       终端                                   │
│  用户点击 → 生成 ANSI 转义序列                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    stdin (raw mode)                          │
│  \x1b[<0;10;5M  (SGR 格式)                                   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    useMouse Hook                             │
│  1. 捕获 stdin 数据                                          │
│  2. 解析鼠标事件                                             │
│  3. 更新 React 状态                                          │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                    UI 组件                                   │
│  响应 onClick, onScroll, onHover 回调                        │
└─────────────────────────────────────────────────────────────┘
```

## 3. 核心实现

### 3.1 类型定义 (`src/tui/mouse/types.ts`)

```typescript
/**
 * 鼠标按钮类型
 */
export type MouseButton = 'left' | 'middle' | 'right' | 'scroll_up' | 'scroll_down' | 'none';

/**
 * 鼠标事件类型
 */
export type MouseEventType = 'press' | 'release' | 'move' | 'scroll';

/**
 * 鼠标事件
 */
export interface MouseEvent {
  /** 事件类型 */
  type: MouseEventType;

  /** 按下的按钮 */
  button: MouseButton;

  /** 列坐标 (1-based) */
  x: number;

  /** 行坐标 (1-based) */
  y: number;

  /** Shift 键是否按下 */
  shift: boolean;

  /** Ctrl 键是否按下 */
  ctrl: boolean;

  /** Alt/Meta 键是否按下 */
  meta: boolean;
}

/**
 * 鼠标跟踪模式
 */
export enum MouseTrackingMode {
  /** 普通跟踪 - 只在按下/释放时发送 */
  NORMAL = 1000,

  /** 按钮事件跟踪 - 包括拖动 */
  BUTTON_EVENT = 1002,

  /** 任意事件跟踪 - 包括移动 (性能影响大) */
  ANY_EVENT = 1003,

  /** SGR 扩展模式 - 使用十进制坐标 */
  SGR_EXTENDED = 1006,

  /** URXVT 扩展模式 */
  URXVT_EXTENDED = 1015,
}

/**
 * useMouse Hook 配置
 */
export interface UseMouseOptions {
  /** 是否启用鼠标支持 */
  enabled?: boolean;

  /** 跟踪模式 */
  mode?: MouseTrackingMode[];

  /** 点击回调 */
  onClick?: (event: MouseEvent) => void;

  /** 滚轮回调 */
  onScroll?: (event: MouseEvent) => void;

  /** 移动回调 (需要 ANY_EVENT 模式) */
  onMove?: (event: MouseEvent) => void;

  /** 释放回调 */
  onRelease?: (event: MouseEvent) => void;
}

/**
 * useMouse Hook 返回值
 */
export interface UseMouseReturn {
  /** 最后一次鼠标事件 */
  lastEvent: MouseEvent | null;

  /** 当前鼠标位置 */
  position: { x: number; y: number } | null;

  /** 是否正在按下 */
  isPressed: boolean;

  /** 按下的按钮 */
  pressedButton: MouseButton | null;
}
```

### 3.2 鼠标跟踪控制 (`src/tui/mouse/tracking.ts`)

```typescript
import { MouseTrackingMode } from './types.js';

const CSI = '\x1b[';

/**
 * 启用鼠标跟踪
 *
 * @param modes 要启用的模式数组
 * @example
 * enableMouseTracking([MouseTrackingMode.NORMAL, MouseTrackingMode.SGR_EXTENDED])
 */
export function enableMouseTracking(modes: MouseTrackingMode[] = [
  MouseTrackingMode.NORMAL,
  MouseTrackingMode.SGR_EXTENDED,
]): void {
  for (const mode of modes) {
    process.stdout.write(`${CSI}?${mode}h`);
  }
}

/**
 * 禁用鼠标跟踪
 *
 * @param modes 要禁用的模式数组
 */
export function disableMouseTracking(modes: MouseTrackingMode[] = [
  MouseTrackingMode.NORMAL,
  MouseTrackingMode.SGR_EXTENDED,
]): void {
  for (const mode of modes) {
    process.stdout.write(`${CSI}?${mode}l`);
  }
}

/**
 * 检测终端是否支持鼠标
 */
export function isMouseSupported(): boolean {
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  const WT_SESSION = process.env.WT_SESSION; // Windows Terminal

  // Windows Terminal
  if (WT_SESSION) {
    return true;
  }

  // 已知支持的终端
  const supportedPatterns = [
    'iTerm.app',
    'Apple_Terminal',
    'xterm',
    'xterm-256color',
    'screen-256color',
    'tmux-256color',
    'gnome-terminal',
    'konsole',
    'alacritty',
    'kitty',
  ];

  return supportedPatterns.some(
    (pattern) =>
      term.toLowerCase().includes(pattern.toLowerCase()) ||
      termProgram.toLowerCase().includes(pattern.toLowerCase()),
  );
}

/**
 * 保存终端状态（用于恢复）
 */
export function saveTerminalState(): void {
  process.stdout.write(`${CSI?s`);
}

/**
 * 恢复终端状态
 */
export function restoreTerminalState(): void {
  process.stdout.write(`${CSI?u`);
}
```

### 3.3 鼠标事件解析器 (`src/tui/mouse/parser.ts`)

```typescript
import type { MouseEvent, MouseButton, MouseEventType } from './types.js';

/**
 * 解析 SGR 格式的鼠标事件 (mode 1006)
 *
 * SGR 格式: ESC [ < Cb ; Cx ; Cy M (按下) 或 ESC [ < Cb ; Cx ; Cy m (释放)
 *
 * Cb 编码:
 * - bit 0-1: 按钮 (0=left, 1=middle, 2=right, 3=release/none)
 * - bit 2: shift
 * - bit 3: meta (alt)
 * - bit 4: ctrl
 * - bit 5: 滚轮 (button 0=up, 1=down)
 * - bit 6: 拖动 (move while pressed)
 *
 * @param data 从 stdin 读取的数据
 * @returns 解析后的鼠标事件，如果不是鼠标事件则返回 null
 */
export function parseMouseSGR(data: string): MouseEvent | null {
  // 匹配 SGR 格式: ESC[<Cb;Cx;CyM 或 ESC[<Cb;Cx;Cym
  const sgrRegex = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
  const match = data.match(sgrRegex);

  if (!match) {
    return null;
  }

  const cb = parseInt(match[1], 10);
  const x = parseInt(match[2], 10);
  const y = parseInt(match[3], 10);
  const isRelease = match[4] === 'm';

  // 解析修饰键
  const shift = (cb & 0b000100) !== 0;
  const meta = (cb & 0b001000) !== 0;
  const ctrl = (cb & 0b010000) !== 0;
  const isScroll = (cb & 0b1000000) !== 0;
  const isMove = (cb & 0b100000) !== 0;

  // 解析按钮
  const buttonCode = cb & 0b11;
  let button: MouseButton;
  let type: MouseEventType;

  if (isScroll) {
    // 滚轮事件
    button = buttonCode === 0 ? 'scroll_up' : 'scroll_down';
    type = 'scroll';
  } else if (isRelease) {
    // 释放事件
    button = buttonCodeToName(buttonCode);
    type = 'release';
  } else if (isMove) {
    // 拖动/移动事件
    button = buttonCodeToName(buttonCode);
    type = 'move';
  } else {
    // 按下事件
    button = buttonCodeToName(buttonCode);
    type = 'press';
  }

  return {
    type,
    button,
    x,
    y,
    shift,
    ctrl,
    meta,
  };
}

/**
 * 解析 URXVT 格式的鼠标事件 (mode 1015)
 *
 * URXVT 格式: ESC [ Cb ; Cx ; Cy M
 */
export function parseMouseURXVT(data: string): MouseEvent | null {
  const urxvtRegex = /\x1b\[(\d+);(\d+);(\d+)M/;
  const match = data.match(urxvtRegex);

  if (!match) {
    return null;
  }

  const cb = parseInt(match[1], 10);
  const x = parseInt(match[2], 10);
  const y = parseInt(match[3], 10);

  // URXVT 编码与 SGR 类似，但值 +32
  const actualCb = cb - 32;

  const shift = (actualCb & 0b000100) !== 0;
  const meta = (actualCb & 0b001000) !== 0;
  const ctrl = (actualCb & 0b010000) !== 0;
  const isScroll = (actualCb & 0b1000000) !== 0;

  const buttonCode = actualCb & 0b11;
  let button: MouseButton;
  let type: MouseEventType;

  if (isScroll) {
    button = buttonCode === 0 ? 'scroll_up' : 'scroll_down';
    type = 'scroll';
  } else if (cb >= 32 && cb <= 34) {
    // 按下
    button = buttonCodeToName(buttonCode);
    type = 'press';
  } else {
    // 释放
    button = buttonCodeToName(buttonCode);
    type = 'release';
  }

  return {
    type,
    button,
    x,
    y,
    shift,
    ctrl,
    meta,
  };
}

/**
 * 解析传统 X10 格式的鼠标事件 (mode 1000)
 *
 * X10 格式: ESC [ M Cb Cx Cy (字符编码)
 */
export function parseMouseX10(data: string): MouseEvent | null {
  const x10Regex = /\x1b\[M([\x20-\xff])([\x20-\xff])([\x20-\xff])/;
  const match = data.match(x10Regex);

  if (!match) {
    return null;
  }

  // 字符值 - 32 得到实际值
  const cb = match[1].charCodeAt(0) - 32;
  const x = match[2].charCodeAt(0) - 32;
  const y = match[3].charCodeAt(0) - 32;

  const shift = (cb & 0b000100) !== 0;
  const meta = (cb & 0b001000) !== 0;
  const ctrl = (cb & 0b010000) !== 0;
  const isScroll = (cb & 0b1000000) !== 0;

  const buttonCode = cb & 0b03;
  let button: MouseButton;
  let type: MouseEventType;

  if (isScroll) {
    button = buttonCode === 0 ? 'scroll_up' : 'scroll_down';
    type = 'scroll';
  } else if (cb >= 0 && cb <= 2) {
    button = buttonCodeToName(buttonCode);
    type = 'press';
  } else if (cb === 3) {
    button = 'none';
    type = 'release';
  } else {
    button = buttonCodeToName(buttonCode);
    type = 'press';
  }

  return {
    type,
    button,
    x,
    y,
    shift,
    ctrl,
    meta,
  };
}

/**
 * 统一的鼠标事件解析器
 * 尝试所有格式直到成功
 */
export function parseMouseEvent(data: string): MouseEvent | null {
  // 优先尝试 SGR 格式 (最现代)
  let event = parseMouseSGR(data);
  if (event) return event;

  // 尝试 URXVT 格式
  event = parseMouseURXVT(data);
  if (event) return event;

  // 尝试传统 X10 格式
  event = parseMouseX10(data);
  if (event) return event;

  return null;
}

/**
 * 按钮代码转换为名称
 */
function buttonCodeToName(code: number): MouseButton {
  switch (code) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    case 3:
      return 'none';
    default:
      return 'none';
  }
}
```

### 3.4 useMouse Hook (`src/tui/mouse/useMouse.ts`)

```typescript
import { useEffect, useRef, useState, useCallback } from 'react';
import type { MouseEvent, UseMouseOptions, UseMouseReturn } from './types.js';
import { MouseTrackingMode } from './types.js';
import { enableMouseTracking, disableMouseTracking, isMouseSupported } from './tracking.js';
import { parseMouseEvent } from './parser.js';

/**
 * 鼠标输入 Hook
 *
 * @example
 * ```tsx
 * const MyComponent = () => {
 *   const { lastEvent, position } = useMouse({
 *     onClick: (e) => console.log('Clicked at', e.x, e.y),
 *     onScroll: (e) => console.log('Scrolled', e.button),
 *   });
 *
 *   return <Text>Mouse at: {position?.x}, {position?.y}</Text>;
 * };
 * ```
 */
export function useMouse(options: UseMouseOptions = {}): UseMouseReturn {
  const {
    enabled = true,
    mode = [MouseTrackingMode.NORMAL, MouseTrackingMode.SGR_EXTENDED],
    onClick,
    onScroll,
    onMove,
    onRelease,
  } = options;

  const [lastEvent, setLastEvent] = useState<MouseEvent | null>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [isPressed, setIsPressed] = useState(false);
  const [pressedButton, setPressedButton] = useState<MouseEvent['button'] | null>(null);

  // 缓冲区用于处理不完整的事件数据
  const bufferRef = useRef('');

  // 回调引用
  const callbacksRef = useRef({ onClick, onScroll, onMove, onRelease });
  callbacksRef.current = { onClick, onScroll, onMove, onRelease };

  // 处理鼠标事件
  const processBuffer = useCallback(() => {
    let event = parseMouseEvent(bufferRef.current);

    while (event) {
      // 更新状态
      setLastEvent(event);
      setPosition({ x: event.x, y: event.y });

      if (event.type === 'press') {
        setIsPressed(true);
        setPressedButton(event.button);
        callbacksRef.current.onClick?.(event);
      } else if (event.type === 'release') {
        setIsPressed(false);
        setPressedButton(null);
        callbacksRef.current.onRelease?.(event);
      } else if (event.type === 'scroll') {
        callbacksRef.current.onScroll?.(event);
      } else if (event.type === 'move') {
        callbacksRef.current.onMove?.(event);
      }

      // 清除已解析的数据
      // 找到并移除匹配的转义序列
      const patterns = [
        /\x1b\[<\d+;\d+;\d+[Mm]/,  // SGR
        /\x1b\[\d+;\d+;\d+M/,      // URXVT
        /\x1b\[M[\x20-\xff]{3}/,   // X10
      ];

      for (const pattern of patterns) {
        const match = bufferRef.current.match(pattern);
        if (match) {
          bufferRef.current = bufferRef.current.slice(match.index! + match[0].length);
          break;
        }
      }

      // 尝试解析下一个事件
      event = parseMouseEvent(bufferRef.current);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    // 检查终端支持
    if (!isMouseSupported()) {
      console.warn('Mouse support: Terminal does not support mouse tracking');
      return;
    }

    // 启用鼠标跟踪
    enableMouseTracking(mode);

    // 确保 stdin 处于 raw 模式
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // 数据处理器
    const handleData = (data: string) => {
      bufferRef.current += data;
      processBuffer();
    };

    process.stdin.on('data', handleData);

    // 清理
    return () => {
      process.stdin.off('data', handleData);
      disableMouseTracking(mode);

      // 清空缓冲区
      bufferRef.current = '';
    };
  }, [enabled, mode, processBuffer]);

  return {
    lastEvent,
    position,
    isPressed,
    pressedButton,
  };
}
```

### 3.5 导出 (`src/tui/mouse/index.ts`)

```typescript
// Types
export type { MouseEvent, MouseButton, MouseEventType, UseMouseOptions, UseMouseReturn } from './types.js';
export { MouseTrackingMode } from './types.js';

// Tracking control
export { enableMouseTracking, disableMouseTracking, isMouseSupported } from './tracking.js';

// Parser
export { parseMouseEvent, parseMouseSGR, parseMouseURXVT, parseMouseX10 } from './parser.js';

// Hook
export { useMouse } from './useMouse.js';
```

## 4. 组件示例

### 4.1 可点击组件 (`src/tui/components/ClickableBox.tsx`)

```typescript
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useMouse, type MouseEvent } from '../mouse/index.js';

interface ClickableBoxProps {
  children: React.ReactNode;
  onClick?: () => void;
  onHover?: (isHovered: boolean) => void;
  disabled?: boolean;
  focused?: boolean;
  width?: number | string;
  padding?: number;
}

/**
 * 可点击的 Box 组件
 */
export const ClickableBox: React.FC<ClickableBoxProps> = ({
  children,
  onClick,
  onHover,
  disabled = false,
  focused = false,
  width,
  padding = 1,
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const boxRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);

  // 计算组件位置（需要在外部测量）
  const isInBounds = useCallback((event: MouseEvent): boolean => {
    if (!boxRef.current) return false;
    const { x, y, width, height } = boxRef.current;
    return (
      event.x >= x &&
      event.x < x + width &&
      event.y >= y &&
      event.y < y + height
    );
  }, []);

  const handleClick = useCallback(
    (event: MouseEvent) => {
      if (disabled) return;
      if (isInBounds(event)) {
        setPressed(true);
        setTimeout(() => setPressed(false), 100);
        onClick?.();
      }
    },
    [disabled, isInBounds, onClick],
  );

  const { position } = useMouse({
    enabled: !disabled,
    onClick: handleClick,
    onMove: (event) => {
      if (isInBounds(event)) {
        if (!hovered) {
          setHovered(true);
          onHover?.(true);
        }
      } else {
        if (hovered) {
          setHovered(false);
          onHover?.(false);
        }
      }
    },
  });

  // 获取边框样式
  const getBorderStyle = () => {
    if (disabled) return 'single';
    if (pressed) return 'double';
    if (hovered || focused) return 'bold';
    return 'single';
  };

  // 获取边框颜色
  const getBorderColor = () => {
    if (disabled) return 'gray';
    if (pressed) return 'green';
    if (hovered || focused) return 'cyan';
    return 'gray';
  };

  return (
    <Box
      flexDirection="column"
      borderStyle={getBorderStyle()}
      borderColor={getBorderColor()}
      width={width}
      paddingX={padding}
    >
      {typeof children === 'string' ? (
        <Text dimColor={disabled}>{children}</Text>
      ) : (
        children
      )}
    </Box>
  );
};
```

### 4.2 滚动列表组件 (`src/tui/components/ScrollableList.tsx`)

```typescript
import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useMouse } from '../mouse/index.js';

interface ScrollableListProps<T> {
  items: T[];
  renderItem: (item: T, index: number, isSelected: boolean) => React.ReactNode;
  height: number;
  onSelect?: (item: T, index: number) => void;
  getKey?: (item: T, index: number) => string | number;
}

/**
 * 支持鼠标滚动的列表组件
 */
export function ScrollableList<T>({
  items,
  renderItem,
  height,
  onSelect,
  getKey = (_, i) => i,
}: ScrollableListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const visibleItems = useMemo(() => {
    return items.slice(scrollTop, scrollTop + height);
  }, [items, scrollTop, height]);

  const handleScroll = useCallback(
    (event) => {
      if (event.button === 'scroll_up') {
        setScrollTop((prev) => Math.max(0, prev - 1));
      } else if (event.button === 'scroll_down') {
        setScrollTop((prev) => Math.min(items.length - height, prev + 1));
      }
    },
    [items.length, height],
  );

  const handleClick = useCallback(
    (event) => {
      // 计算点击的列表项索引
      const clickedIndex = scrollTop + event.y - 1; // -1 是因为列表起始位置
      if (clickedIndex >= 0 && clickedIndex < items.length) {
        setSelectedIndex(clickedIndex);
        onSelect?.(items[clickedIndex], clickedIndex);
      }
    },
    [items, scrollTop, onSelect],
  );

  useMouse({
    onScroll: handleScroll,
    onClick: handleClick,
  });

  return (
    <Box flexDirection="column" height={height}>
      {visibleItems.map((item, i) => {
        const actualIndex = scrollTop + i;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={getKey(item, actualIndex)}>
            {renderItem(item, actualIndex, isSelected)}
          </Box>
        );
      })}

      {/* 滚动指示器 */}
      {items.length > height && (
        <Box>
          <Text dimColor>
            [{scrollTop + 1}-{Math.min(scrollTop + height, items.length)} / {items.length}]
          </Text>
        </Box>
      )}
    </Box>
  );
}
```

### 4.3 按钮组件 (`src/tui/components/Button.tsx`)

```typescript
import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { useMouse } from '../mouse/index.js';

interface ButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}

/**
 * 按钮组件
 */
export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  disabled = false,
  variant = 'primary',
}) => {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  const { position } = useMouse({
    enabled: !disabled,
    onClick: useCallback(() => {
      if (!disabled) {
        setPressed(true);
        setTimeout(() => setPressed(false), 100);
        onClick?.();
      }
    }, [disabled, onClick]),
  });

  // 颜色配置
  const colors = {
    primary: { bg: 'blue', fg: 'white' },
    secondary: { bg: 'gray', fg: 'white' },
    danger: { bg: 'red', fg: 'white' },
  };

  const color = colors[variant];

  return (
    <Box
      paddingX={2}
      paddingY={0}
      backgroundColor={disabled ? 'gray' : pressed ? 'green' : hovered ? 'cyan' : color.bg}
    >
      <Text
        bold={hovered || pressed}
        color={disabled ? 'gray' : color.fg}
        dimColor={disabled}
      >
        {label}
      </Text>
    </Box>
  );
};
```

## 5. 与现有 TUI 集成

### 5.1 在 App.tsx 中启用

```typescript
// src/tui/App.tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { useMouse, isMouseSupported } from './mouse/index.js';
import { MessageList } from './components/MessageList';
import { InputBox } from './components/InputBox';

export const App: React.FC<AppProps> = ({ clientOptions }) => {
  const [mouseEnabled, setMouseEnabled] = useState(false);

  useEffect(() => {
    // 检测并启用鼠标支持
    if (isMouseSupported()) {
      setMouseEnabled(true);
      console.log('Mouse support enabled');
    }
  }, []);

  // 全局鼠标状态（可选）
  const { position } = useMouse({
    enabled: mouseEnabled,
    onScroll: (event) => {
      // 全局滚动处理，如滚动历史
      if (event.button === 'scroll_up') {
        // scrollUp();
      } else if (event.button === 'scroll_down') {
        // scrollDown();
      }
    },
  });

  return (
    <Box flexDirection="column">
      {/* 鼠标状态指示器（调试用） */}
      {mouseEnabled && position && (
        <Box position="absolute" right={0}>
          <Text dimColor>🖱️ {position.x},{position.y}</Text>
        </Box>
      )}

      <MessageList messages={messages} />
      <InputBox onSubmit={handleSubmit} />
    </Box>
  );
};
```

### 5.2 处理与键盘输入的冲突

鼠标事件通过 stdin 传输，可能与键盘输入混在一起。需要确保：

1. **stdin 必须是 raw 模式**
2. **正确解析和分离鼠标事件**
3. **非鼠标数据传递给键盘处理器**

```typescript
// src/tui/hooks/useInputWithMouse.ts
import { useInput } from 'ink';
import { useMouse } from '../mouse/index.js';

export function useInputWithMouse(
  handleInput: (input: string, key: any) => void,
  options: { isActive?: boolean } = {},
) {
  const { isActive = true } = options;

  // 鼠标输入由 useMouse 处理
  useMouse({ enabled: isActive });

  // 键盘输入由 useInput 处理
  // 注意：鼠标事件会在 useMouse 中被过滤掉
  useInput(
    (input, key) => {
      // 检查是否是鼠标转义序列
      if (input.includes('\x1b[')) {
        // 忽略，由 useMouse 处理
        return;
      }
      handleInput(input, key);
    },
    { isActive },
  );
}
```

## 6. 测试

### 6.1 单元测试 (`src/tui/mouse/__tests__/parser.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { parseMouseSGR, parseMouseEvent } from '../parser.js';

describe('Mouse Parser', () => {
  describe('parseMouseSGR', () => {
    it('should parse left click', () => {
      const event = parseMouseSGR('\x1b[<0;10;5M');
      expect(event).toEqual({
        type: 'press',
        button: 'left',
        x: 10,
        y: 5,
        shift: false,
        ctrl: false,
        meta: false,
      });
    });

    it('should parse right click', () => {
      const event = parseMouseSGR('\x1b[<2;20;10M');
      expect(event).toEqual({
        type: 'press',
        button: 'right',
        x: 20,
        y: 10,
        shift: false,
        ctrl: false,
        meta: false,
      });
    });

    it('should parse release', () => {
      const event = parseMouseSGR('\x1b[<0;10;5m');
      expect(event?.type).toBe('release');
    });

    it('should parse scroll up', () => {
      const event = parseMouseSGR('\x1b[<64;15;8M');
      expect(event).toEqual({
        type: 'scroll',
        button: 'scroll_up',
        x: 15,
        y: 8,
        shift: false,
        ctrl: false,
        meta: false,
      });
    });

    it('should parse scroll down', () => {
      const event = parseMouseSGR('\x1b[<65;15;8M');
      expect(event).toEqual({
        type: 'scroll',
        button: 'scroll_down',
        x: 15,
        y: 8,
        shift: false,
        ctrl: false,
        meta: false,
      });
    });

    it('should parse modifiers', () => {
      const event = parseMouseSGR('\x1b[<4;10;5M'); // shift + left click
      expect(event?.shift).toBe(true);
    });
  });

  describe('parseMouseEvent', () => {
    it('should return null for non-mouse input', () => {
      expect(parseMouseEvent('hello')).toBeNull();
      expect(parseMouseEvent('')).toBeNull();
    });
  });
});
```

## 7. 注意事项

### 7.1 性能考虑

1. **避免使用 mode 1003**（任意事件跟踪），会产生大量移动事件
2. **对 onMove 回调进行节流**
3. **不要在每次鼠标移动时触发 React 重渲染**

### 7.2 终端兼容性

1. **始终检测终端支持**（`isMouseSupported()`）
2. **提供键盘备选方案**
3. **在 tmux 中需要额外配置**：
   ```bash
   # ~/.tmux.conf
   set -g mouse on
   ```

### 7.3 清理

1. **程序退出时必须禁用鼠标跟踪**
2. **异常情况下也要清理**（使用 try-finally 或 useEffect 清理函数）

## 8. 依赖

无需额外依赖，使用 Node.js 内置的 stdin/stdout。

## 9. 未来扩展

- [ ] 鼠标拖拽选择文本
- [ ] 右键菜单
- [ ] 双击检测
- [ ] 手势支持（如三指滑动）
- [ ] 触摸屏支持（某些终端支持）

## 10. 参考资料

- [XTerm Control Sequences (PDF)](https://invisible-island.net/xterm/ctlseqs/ctlseqs.pdf)
- [XFree86 Xterm Control Sequences](https://www.xfree86.org/current/ctlseqs.html)
- [Stack Overflow: Mouse wheel sequences](https://stackoverflow.com/questions/46627983/)

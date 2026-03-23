import { useEffect, useCallback, useRef } from "react";
import { enableMouse, disableMouse, parseMouseSGR, MouseEvent } from "../utils/mouse.js";


interface UseMouseOptions {
    enabled?: boolean
    mode?: number
    onClick?: (event: MouseEvent) => void
    onMove?: (event: MouseEvent) => void
}


export function useMouse(options: UseMouseOptions = {}) {
    const {
        enabled = true,
        mode = 1006,
        onClick,
        onMove,
    } = options;

    const buffer = useRef('');

    useEffect(() => {
        if (!enabled) return;

        // 启用鼠标
        enableMouse(mode);

        // 设置 stdin 为 raw 模式
        process.stdin.setRawMode(true);
        process.stdin.resume();

        const handler = (data: Buffer) => {
            buffer.current += data.toString();

            // 尝试解析鼠标事件
            while (buffer.current.includes('\x1b[<')) {
                const event = parseMouseSGR(buffer.current);
                if (event) {
                    // 清除已解析的数据
                    const match = buffer.current.match(/\x1b\[<\d+;\d+;\d+[Mm]/);
                    if (match) {
                        buffer.current = buffer.current.replace(match[0], '');
                    }

                    // 触发回调
                    if (event.type === 'press' && onClick) {
                        onClick(event);
                    } else if (event.type === 'move' && onMove) {
                        onMove(event);
                    }
                } else {
                    break;
                }
            }
        };

        process.stdin.on('data', handler);

        return () => {
            process.stdin.off('data', handler);
            disableMouse(mode);
        };
    }, [enabled, mode, onClick, onMove]);
}
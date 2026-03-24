import { useState, useCallback, useRef } from "react";
import type { InputBuffer } from "./useInputBuffer.js";

export function useInputHistory(buffer: InputBuffer) {
	const [history, setHistory] = useState<string[]>([]);
	const [index, setIndex] = useState(-1);

	const bufferRef = useRef(buffer);
	bufferRef.current = buffer;
	const historyRef = useRef(history);
	historyRef.current = history;

	const push = useCallback((text: string) => {
		if (!text.trim()) return;
		setHistory((prev) => [...prev, text]);
		setIndex(-1);
	}, []);

	const navigateUp = useCallback(() => {
		setIndex((prev) => {
			const h = historyRef.current;
			const next = Math.min(prev + 1, h.length - 1);
			if (next !== prev && h.length > 0) {
				bufferRef.current.setText(h[h.length - 1 - next]);
			}
			return next;
		});
	}, []);

	const navigateDown = useCallback(() => {
		setIndex((prev) => {
			const h = historyRef.current;
			if (prev > 0) {
				const next = prev - 1;
				bufferRef.current.setText(h[h.length - 1 - next]);
				return next;
			}
			if (prev === 0) {
				bufferRef.current.clear();
				return -1;
			}
			return prev;
		});
	}, []);

	const reset = useCallback(() => setIndex(-1), []);

	return { push, navigateUp, navigateDown, reset, index };
}

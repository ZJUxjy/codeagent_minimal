import { useReducer, useCallback, useMemo } from "react";

interface UndoFrame {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
}

interface InputBufferState {
	lines: string[];
	cursorRow: number;
	cursorCol: number;
	undoStack: UndoFrame[];
	redoStack: UndoFrame[];
}

type MoveDir = "left" | "right" | "up" | "down" | "home" | "end" | "doc_start" | "doc_end";

export type InputBufferAction =
	| { type: "insert"; payload: string }
	| { type: "newline" }
	| { type: "backspace" }
	| { type: "delete" }
	| { type: "move"; dir: MoveDir }
	| { type: "move_word"; dir: "left" | "right" }
	| { type: "kill_line_right" }
	| { type: "kill_line_left" }
	| { type: "delete_word_left" }
	| { type: "set_text"; payload: string }
	| { type: "clear" }
	| { type: "snapshot" }
	| { type: "undo" }
	| { type: "redo" }
	| { type: "replace_range_by_offset"; start: number; end: number; replacement: string };

const MAX_UNDO_STACK = 100;

const INITIAL: InputBufferState = {
	lines: [""],
	cursorRow: 0,
	cursorCol: 0,
	undoStack: [],
	redoStack: [],
};

function reducer(state: InputBufferState, action: InputBufferAction): InputBufferState {
	const { lines, cursorRow, cursorCol } = state;

	switch (action.type) {
		case "insert": {
			const line = lines[cursorRow] ?? "";
			const before = line.slice(0, cursorCol);
			const after = line.slice(cursorCol);
			const parts = action.payload.split("\n");

			if (parts.length === 1) {
				const next = [...lines];
				next[cursorRow] = before + parts[0] + after;
				return { ...state, lines: next, cursorCol: cursorCol + parts[0].length };
			}

			const firstLine = before + parts[0];
			const lastPart = parts[parts.length - 1];
			const lastLine = lastPart + after;
			const middleLines = parts.slice(1, -1);
			const next = [
				...lines.slice(0, cursorRow),
				firstLine,
				...middleLines,
				lastLine,
				...lines.slice(cursorRow + 1),
			];
			return {
				...state,
				lines: next,
				cursorRow: cursorRow + parts.length - 1,
				cursorCol: lastPart.length,
			};
		}

		case "newline": {
			const line = lines[cursorRow] ?? "";
			const before = line.slice(0, cursorCol);
			const after = line.slice(cursorCol);
			const next = [
				...lines.slice(0, cursorRow),
				before,
				after,
				...lines.slice(cursorRow + 1),
			];
			return { ...state, lines: next, cursorRow: cursorRow + 1, cursorCol: 0 };
		}

		case "backspace": {
			if (cursorCol > 0) {
				const line = lines[cursorRow];
				const next = [...lines];
				next[cursorRow] = line.slice(0, cursorCol - 1) + line.slice(cursorCol);
				return { ...state, lines: next, cursorCol: cursorCol - 1 };
			}
			if (cursorRow > 0) {
				const prevLine = lines[cursorRow - 1];
				const currLine = lines[cursorRow];
				const next = [
					...lines.slice(0, cursorRow - 1),
					prevLine + currLine,
					...lines.slice(cursorRow + 1),
				];
				return { ...state, lines: next, cursorRow: cursorRow - 1, cursorCol: prevLine.length };
			}
			return state;
		}

		case "delete": {
			const line = lines[cursorRow];
			if (cursorCol < line.length) {
				const next = [...lines];
				next[cursorRow] = line.slice(0, cursorCol) + line.slice(cursorCol + 1);
				return { ...state, lines: next };
			}
			if (cursorRow < lines.length - 1) {
				const next = [
					...lines.slice(0, cursorRow),
					line + lines[cursorRow + 1],
					...lines.slice(cursorRow + 2),
				];
				return { ...state, lines: next };
			}
			return state;
		}

		case "move": {
			switch (action.dir) {
				case "left": {
					if (cursorCol > 0) return { ...state, cursorCol: cursorCol - 1 };
					if (cursorRow > 0) {
						return {
							...state,
							cursorRow: cursorRow - 1,
							cursorCol: lines[cursorRow - 1].length,
						};
					}
					return state;
				}
				case "right": {
					const len = lines[cursorRow].length;
					if (cursorCol < len) return { ...state, cursorCol: cursorCol + 1 };
					if (cursorRow < lines.length - 1) {
						return {
							...state,
							cursorRow: cursorRow + 1,
							cursorCol: 0,
						};
					}
					return state;
				}
				case "up": {
					if (cursorRow > 0) {
						return {
							...state,
							cursorRow: cursorRow - 1,
							cursorCol: Math.min(cursorCol, lines[cursorRow - 1].length),
						};
					}
					return state;
				}
				case "down": {
					if (cursorRow < lines.length - 1) {
						return {
							...state,
							cursorRow: cursorRow + 1,
							cursorCol: Math.min(cursorCol, lines[cursorRow + 1].length),
						};
					}
					return state;
				}
				case "home":
					return { ...state, cursorCol: 0 };
				case "end":
					return { ...state, cursorCol: lines[cursorRow].length };
				case "doc_start":
					return { ...state, cursorRow: 0, cursorCol: 0 };
				case "doc_end": {
					const last = lines.length - 1;
					return { ...state, cursorRow: last, cursorCol: lines[last].length };
				}
			}
			return state;
		}

		case "move_word": {
			const line = lines[cursorRow];
			let col = cursorCol;
			if (action.dir === "left") {
				while (col > 0 && line[col - 1] === " ") col--;
				while (col > 0 && line[col - 1] !== " ") col--;
			} else {
				while (col < line.length && line[col] !== " ") col++;
				while (col < line.length && line[col] === " ") col++;
			}
			return { ...state, cursorCol: col };
		}

		case "kill_line_right": {
			const line = lines[cursorRow];
			if (cursorCol < line.length) {
				const next = [...lines];
				next[cursorRow] = line.slice(0, cursorCol);
				return { ...state, lines: next };
			}
			if (cursorRow < lines.length - 1) {
				const next = [
					...lines.slice(0, cursorRow),
					line + lines[cursorRow + 1],
					...lines.slice(cursorRow + 2),
				];
				return { ...state, lines: next };
			}
			return state;
		}

		case "kill_line_left": {
			const line = lines[cursorRow];
			const next = [...lines];
			next[cursorRow] = line.slice(cursorCol);
			return { ...state, lines: next, cursorCol: 0 };
		}

		case "delete_word_left": {
			const line = lines[cursorRow];
			let col = cursorCol;
			while (col > 0 && line[col - 1] === " ") col--;
			while (col > 0 && line[col - 1] !== " ") col--;
			const next = [...lines];
			next[cursorRow] = line.slice(0, col) + line.slice(cursorCol);
			return { ...state, lines: next, cursorCol: col };
		}

		case "set_text": {
			const newLines = action.payload.split("\n");
			const last = newLines.length - 1;
			return {
				...state,
				lines: newLines,
				cursorRow: last,
				cursorCol: newLines[last].length,
				redoStack: [],
			};
		}

		case "clear": {
			return { ...state, lines: [""], cursorRow: 0, cursorCol: 0 };
		}

		case "snapshot": {
			const frame: UndoFrame = { lines, cursorRow, cursorCol };
			const stack = [...state.undoStack, frame];
			if (stack.length > MAX_UNDO_STACK) stack.shift();
			return { ...state, undoStack: stack, redoStack: [] };
		}

		case "undo": {
			if (state.undoStack.length === 0) return state;
			const prev = state.undoStack[state.undoStack.length - 1];
			const current: UndoFrame = { lines, cursorRow, cursorCol };
			return {
				...state,
				lines: prev.lines,
				cursorRow: prev.cursorRow,
				cursorCol: prev.cursorCol,
				undoStack: state.undoStack.slice(0, -1),
				redoStack: [current, ...state.redoStack],
			};
		}

		case "redo": {
			if (state.redoStack.length === 0) return state;
			const next = state.redoStack[0];
			const current: UndoFrame = { lines, cursorRow, cursorCol };
			return {
				...state,
				lines: next.lines,
				cursorRow: next.cursorRow,
				cursorCol: next.cursorCol,
				undoStack: [...state.undoStack, current],
				redoStack: state.redoStack.slice(1),
			};
		}

		case "replace_range_by_offset": {
			const fullText = lines.join("\n");
			const { start, end, replacement } = action;
			const newText = fullText.slice(0, start) + replacement + fullText.slice(end);
			const newLines = newText === "" ? [""] : newText.split("\n");
			const newOffset = start + replacement.length;
			let remaining = newOffset;
			let newRow = 0;
			while (newRow < newLines.length - 1 && remaining > newLines[newRow].length) {
				remaining -= newLines[newRow].length + 1;
				newRow++;
			}
			return {
				...state,
				lines: newLines,
				cursorRow: newRow,
				cursorCol: remaining,
			};
		}

		default:
			return state;
	}
}

export function useInputBuffer() {
	const [state, dispatch] = useReducer(reducer, INITIAL);

	const text = useMemo(() => state.lines.join("\n"), [state.lines]);

	const insert = useCallback((payload: string) => dispatch({ type: "insert", payload }), []);
	const newline = useCallback(() => dispatch({ type: "newline" }), []);
	const backspace = useCallback(() => dispatch({ type: "backspace" }), []);
	const del = useCallback(() => dispatch({ type: "delete" }), []);
	const move = useCallback((dir: MoveDir) => dispatch({ type: "move", dir }), []);
	const moveWord = useCallback(
		(dir: "left" | "right") => dispatch({ type: "move_word", dir }),
		[],
	);
	const killLineRight = useCallback(() => dispatch({ type: "kill_line_right" }), []);
	const killLineLeft = useCallback(() => dispatch({ type: "kill_line_left" }), []);
	const deleteWordLeft = useCallback(() => dispatch({ type: "delete_word_left" }), []);
	const setText = useCallback((payload: string) => dispatch({ type: "set_text", payload }), []);
	const clear = useCallback(() => dispatch({ type: "clear" }), []);
	const snapshot = useCallback(() => dispatch({ type: "snapshot" }), []);
	const undo = useCallback(() => dispatch({ type: "undo" }), []);
	const redo = useCallback(() => dispatch({ type: "redo" }), []);
	const replaceRangeByOffset = useCallback(
		(start: number, end: number, replacement: string) =>
			dispatch({ type: "replace_range_by_offset", start, end, replacement }),
		[],
	);

	return {
		text,
		lines: state.lines,
		cursor: { row: state.cursorRow, col: state.cursorCol },
		hasUndo: state.undoStack.length > 0,
		hasRedo: state.redoStack.length > 0,
		insert,
		newline,
		backspace,
		delete: del,
		move,
		moveWord,
		killLineRight,
		killLineLeft,
		deleteWordLeft,
		setText,
		clear,
		snapshot,
		undo,
		redo,
		replaceRangeByOffset,
	};
}

export type InputBuffer = ReturnType<typeof useInputBuffer>;

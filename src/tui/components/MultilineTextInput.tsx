import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { InputBuffer } from "../hooks/useInputBuffer.js";

interface MultilineTextInputProps {
	buffer: InputBuffer;
	placeholder?: string;
	showCursor?: boolean;
	focus?: boolean;
	maxVisibleLines?: number;
}

export const MultilineTextInput: React.FC<MultilineTextInputProps> = ({
	buffer,
	placeholder,
	showCursor = true,
	focus = true,
	maxVisibleLines = 8,
}) => {
	const { lines, cursor } = buffer;

	const startRow = useMemo(() => {
		if (lines.length <= maxVisibleLines) return 0;
		const half = Math.floor(maxVisibleLines / 2);
		return Math.max(0, Math.min(cursor.row - half, lines.length - maxVisibleLines));
	}, [lines.length, cursor.row, maxVisibleLines]);

	const visibleLines = lines.slice(startRow, startRow + maxVisibleLines);
	const isEmpty = lines.length === 1 && lines[0] === "";

	if (isEmpty && placeholder) {
		if (!focus || !showCursor) {
			return <Text dimColor>{placeholder}</Text>;
		}
		return (
			<Box>
				<Text inverse>{" "}</Text>
				<Text dimColor>{placeholder}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{visibleLines.map((line, idx) => {
				const absRow = startRow + idx;
				const isCursorRow = absRow === cursor.row;

				if (!isCursorRow || !showCursor || !focus) {
					return <Text key={absRow}>{line || " "}</Text>;
				}

				const col = cursor.col;
				const before = line.slice(0, col);
				const ch = line[col] ?? " ";
				const after = line.slice(col + 1);

				return (
					<Text key={absRow}>
						{before}
						<Text inverse>{ch}</Text>
						{after}
					</Text>
				);
			})}
		</Box>
	);
};

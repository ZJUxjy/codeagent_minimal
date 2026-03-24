import React, {
	createContext,
	useContext,
	useEffect,
	useRef,
	useCallback,
} from "react";

export interface PasteKey {
	paste: true;
	sequence: string;
}

type PasteHandler = (key: PasteKey) => void;

interface KeypressContextValue {
	subscribePaste: (handler: PasteHandler) => void;
	unsubscribePaste: (handler: PasteHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | null>(null);

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function KeypressProvider({ children }: { children: React.ReactNode }) {
	const subscribers = useRef<Set<PasteHandler>>(new Set());
	const pasteBuffer = useRef("");
	const isPasting = useRef(false);

	const broadcast = useCallback((key: PasteKey) => {
		for (const handler of subscribers.current) {
			handler(key);
		}
	}, []);

	useEffect(() => {
		process.stdout.write("\x1b[?2004h");

		const handleData = (data: Buffer) => {
			const str = data.toString();

			if (!isPasting.current && str.includes(PASTE_START)) {
				isPasting.current = true;
				pasteBuffer.current = str.slice(
					str.indexOf(PASTE_START) + PASTE_START.length,
				);

				if (pasteBuffer.current.includes(PASTE_END)) {
					const end = pasteBuffer.current.indexOf(PASTE_END);
					const text = pasteBuffer.current.slice(0, end);
					isPasting.current = false;
					pasteBuffer.current = "";
					broadcast({ paste: true, sequence: text });
				}
				return;
			}

			if (isPasting.current) {
				if (str.includes(PASTE_END)) {
					pasteBuffer.current += str.slice(0, str.indexOf(PASTE_END));
					const text = pasteBuffer.current;
					isPasting.current = false;
					pasteBuffer.current = "";
					broadcast({ paste: true, sequence: text });
				} else {
					pasteBuffer.current += str;
				}
				return;
			}
		};

		process.stdin.on("data", handleData);
		return () => {
			process.stdin.off("data", handleData);
			process.stdout.write("\x1b[?2004l");
		};
	}, [broadcast]);

	const subscribePaste = useCallback((handler: PasteHandler) => {
		subscribers.current.add(handler);
	}, []);

	const unsubscribePaste = useCallback((handler: PasteHandler) => {
		subscribers.current.delete(handler);
	}, []);

	return (
		<KeypressContext.Provider value={{ subscribePaste, unsubscribePaste }}>
			{children}
		</KeypressContext.Provider>
	);
}

export function useKeypressContext() {
	const context = useContext(KeypressContext);
	if (!context) {
		throw new Error("useKeypressContext must be used inside KeypressProvider");
	}
	return context;
}

export function usePasteHandler(
	handler: PasteHandler,
	{ isActive }: { isActive: boolean },
) {
	const { subscribePaste, unsubscribePaste } = useKeypressContext();
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const stableHandler = useCallback(
		(key: PasteKey) => handlerRef.current(key),
		[],
	);

	useEffect(() => {
		if (!isActive) {
			return;
		}
		subscribePaste(stableHandler);
		return () => {
			unsubscribePaste(stableHandler);
		};
	}, [isActive, stableHandler, subscribePaste, unsubscribePaste]);
}

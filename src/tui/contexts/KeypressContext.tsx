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

export interface RawKey {
    type: 'backspace' | 'forwardDelete'
}
type RawKeyHandler = (key: RawKey) => void

interface KeypressContextValue {
	subscribePaste: (handler: PasteHandler) => void;
	unsubscribePaste: (handler: PasteHandler) => void;
	subscribeKey: (handler: RawKeyHandler) => void;
	unsubscribeKey: (handler: RawKeyHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | null>(null);

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

export function KeypressProvider({ children }: { children: React.ReactNode }) {
	const subscribers = useRef<Set<PasteHandler>>(new Set());
	const keySubscribers = useRef<Set<RawKeyHandler>>(new Set());
	const pasteBuffer = useRef("");
	const isPasting = useRef(false);

	const broadcast = useCallback((key: PasteKey) => {
		for (const handler of subscribers.current) {
			handler(key);
		}
	}, []);

	const broadcastKey = useCallback((key: RawKey) => {
		for (const handler of keySubscribers.current) {
			handler(key);
		}
	}, []);

	// Use refs to avoid effect re-runs when these callbacks change
	const broadcastRef = useRef(broadcast);
	const broadcastKeyRef = useRef(broadcastKey);
	broadcastRef.current = broadcast;
	broadcastKeyRef.current = broadcastKey;

	useEffect(() => {
		process.stdout.write("\x1b[?2004h");

		const handleData = (data: Buffer) => {
			const str = data.toString();

			// Ink maps \x7f to key.delete incorrectly; intercept at raw level for correct semantics
			if (str === '\x7f' || str === '\x08') {
				broadcastKeyRef.current({ type: 'backspace' });
				return;
			}
			if (str === '\x1b[3~') {
				broadcastKeyRef.current({ type: 'forwardDelete' });
				return;
			}

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
					broadcastRef.current({ paste: true, sequence: text });
				}
				return;
			}

			if (isPasting.current) {
				if (str.includes(PASTE_END)) {
					pasteBuffer.current += str.slice(0, str.indexOf(PASTE_END));
					const text = pasteBuffer.current;
					isPasting.current = false;
					pasteBuffer.current = "";
					broadcastRef.current({ paste: true, sequence: text });
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
	}, []);

	const subscribePaste = useCallback((handler: PasteHandler) => {
		subscribers.current.add(handler);
	}, []);

	const unsubscribePaste = useCallback((handler: PasteHandler) => {
		subscribers.current.delete(handler);
	}, []);

	const subscribeKey = useCallback((handler: RawKeyHandler) => {
		keySubscribers.current.add(handler);
	}, []);

	const unsubscribeKey = useCallback((handler: RawKeyHandler) => {
		keySubscribers.current.delete(handler);
	}, []);

	return (
		<KeypressContext.Provider value={{ subscribePaste, unsubscribePaste, subscribeKey, unsubscribeKey }}>
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

export function useKeyHandler(
	handler: (key: RawKey) => void,
	{ isActive }: { isActive: boolean },
) {
	const { subscribeKey, unsubscribeKey } = useKeypressContext();
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	const stableHandler = useCallback(
		(key: RawKey) => handlerRef.current(key),
		[],
	);

	useEffect(() => {
		if (!isActive) {
			return;
		}
		subscribeKey(stableHandler);
		return () => {
			unsubscribeKey(stableHandler);
		};
	}, [isActive, stableHandler, subscribeKey, unsubscribeKey]);
}

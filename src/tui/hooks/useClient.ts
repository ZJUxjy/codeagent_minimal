import { useState, useEffect, useRef } from 'react'
import { Client, type ClientOptions, type ClientEvent } from '../../client/index.js'
import { FileStore } from '../../server/stores/FileStore.js'

export interface UseClientOptions extends ClientOptions {
    onEvent?: (event: ClientEvent) => void
}

export function useClient(options: UseClientOptions) {
    const [client, setClient] = useState<Client | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sessionId, setSessionId] = useState<string | null>(null);

    // 提取 onEvent 避免 useEffect 依赖频繁变化
    const onEventRef = useRef(options.onEvent);
    useEffect(() => {
        onEventRef.current = options.onEvent;
    }, [options.onEvent]);

    useEffect(() => {
        const clientInstance = new Client(options);

        clientInstance.initialize()
            .then(async (result) => {
                setSessionId(result.sessionId ?? null);

                // --resume flag: auto-load latest session
                if (options.resume) {
                    const cwd = options.cwd ?? process.cwd();
                    const sessions = FileStore.listSessions(cwd);
                    if (sessions.length > 0) {
                        const loadResult = await clientInstance.loadSession(sessions[0].sessionId);
                        setSessionId(loadResult.sessionId);
                    }
                }

                // 注册事件处理器
                if (onEventRef.current) {
                    clientInstance.onEvent(onEventRef.current);
                }
                setClient(clientInstance);
                setIsReady(true);
            })
            .catch((err: any) => {
                setError(err.message);
            });

        return () => {
            clientInstance.close();
        };
        // options 在组件生命周期内应该是稳定的，只在挂载时初始化一次
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return {
        client,
        isReady,
        error,
        sessionId,
    };
}

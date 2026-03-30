import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import { KeypressProvider } from "./contexts/KeypressContext.js";
import type { ClientOptions } from "../client/index.js";

export async function startTUI(options: ClientOptions) {
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
    await instance.waitUntilExit()
}

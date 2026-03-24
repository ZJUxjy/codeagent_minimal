import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import type { ClientOptions } from "../client/index.js";

export function startTUI(options: ClientOptions) {
    const instance = render(
        <App
            clientOptions={options}
            clearScreen={() => {
                instance.clear()
                process.stdout.write('\x1b[2J\x1b[3J\x1b[H')
            }}
        />,
    )
}

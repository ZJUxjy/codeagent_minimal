import React from "react";
import { render } from "ink";
import { App } from "./App.js";
import type { ClientOptions } from "../client/index.js";

export function startTUI(options:ClientOptions){
    render(<App clientOptions={options}/>)
}



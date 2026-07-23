import React from "react";
import ReactDOM from "react-dom/client";
import { DebugApp } from "./windows/debug/DebugApp";

ReactDOM.createRoot(document.getElementById("debug-root") as HTMLElement).render(
  <React.StrictMode>
    <DebugApp />
  </React.StrictMode>,
);

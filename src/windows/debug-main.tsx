/**
 * Entry point for the debug window — a separate Tauri window/HTML root from
 * the main app, bootstrapping only DebugApp plus the shared design tokens.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { DebugApp } from "./debug/DebugApp";
import "../ui/tokens.css";
import "../ui/base.css";

ReactDOM.createRoot(document.getElementById("debug-root") as HTMLElement).render(
  <React.StrictMode>
    <DebugApp />
  </React.StrictMode>,
);

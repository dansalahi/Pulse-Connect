import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import "./reset.css";

// Global error handlers — breadcrumb telemetry only, no network calls.
// Failures are swallowed (.catch) so these never affect the app.
window.addEventListener("error", (e) => {
  void invoke("add_breadcrumb", {
    category: "error",
    message: `${e.message} at ${e.filename}:${e.lineno}`,
  }).catch((err: unknown) => {
    console.warn("[telemetry] error breadcrumb failed:", err);
  });
});
window.addEventListener("unhandledrejection", (e) => {
  void invoke("add_breadcrumb", {
    category: "error",
    message: `unhandled rejection: ${String(e.reason)}`,
  }).catch((err: unknown) => {
    console.warn("[telemetry] rejection breadcrumb failed:", err);
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

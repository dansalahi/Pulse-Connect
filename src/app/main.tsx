import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ipc } from "../lib/ipc/commands";
import "../ui/tokens.css";
import "../ui/base.css";

// Global error handlers — breadcrumb telemetry only, no network calls.
// Failures are swallowed (.catch) so these never affect the app.
window.addEventListener("error", (e) => {
  void ipc.telemetry
    .addBreadcrumb("error", `${e.message} at ${e.filename}:${e.lineno}`)
    .catch((err: unknown) => {
      console.warn("[telemetry] error breadcrumb failed:", err);
    });
});
window.addEventListener("unhandledrejection", (e) => {
  void ipc.telemetry
    .addBreadcrumb("error", `unhandled rejection: ${String(e.reason)}`)
    .catch((err: unknown) => {
      console.warn("[telemetry] rejection breadcrumb failed:", err);
    });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

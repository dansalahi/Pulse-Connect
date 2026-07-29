/**
 * Entry point for the overlay pill window — a separate Tauri window/HTML
 * root from the main app, bootstrapping only OverlayApp plus shared tokens.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { OverlayApp } from "../features/overlay/components/OverlayApp";
import "../ui/tokens.css";
import "../ui/base.css";

ReactDOM.createRoot(
  document.getElementById("overlay-root") as HTMLElement,
).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);

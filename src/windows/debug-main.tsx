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

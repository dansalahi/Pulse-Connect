import React from "react";
import ReactDOM from "react-dom/client";
import { OverlayApp } from "./windows/overlay/OverlayApp";

ReactDOM.createRoot(
  document.getElementById("overlay-root") as HTMLElement,
).render(
  <React.StrictMode>
    <OverlayApp />
  </React.StrictMode>,
);
